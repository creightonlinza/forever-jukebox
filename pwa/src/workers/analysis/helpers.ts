export type Quantum = {
  start: number;
  duration: number;
  confidence?: number;
};

export type Segment = {
  start: number;
  duration: number;
  confidence: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  pitches: number[];
  timbre: number[];
};

export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) {
    return channels[0].slice();
  }
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(length);
  if (length === 0) {
    return out;
  }
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) {
      out[i] += (channel[i] ?? 0) / channels.length;
    }
  }
  return out;
}

export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate || samples.length === 0) {
    return samples.slice();
  }
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.floor(samples.length * ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i / ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const s0 = samples[idx] ?? 0;
    const s1 = samples[idx + 1] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

export function makeQuanta(starts: number[], duration: number, confidences?: number[]) {
  const out: Quantum[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : duration;
    const q: Quantum = {
      start: starts[i],
      duration: Math.max(0, end - starts[i]),
    };
    if (confidences?.[i] !== undefined) {
      q.confidence = confidences[i];
    }
    out.push(q);
  }
  return out;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function computeTempo(beatTimes: number[]) {
  const tempos: number[] = [];
  for (let i = 0; i < beatTimes.length - 1; i += 1) {
    const dt = beatTimes[i + 1] - beatTimes[i];
    if (dt > 0) {
      tempos.push(60 / dt);
    }
  }
  return median(tempos);
}

function zscore(matrix: number[][]) {
  if (matrix.length === 0) {
    return matrix;
  }
  const dim = matrix[0].length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const row of matrix) {
    for (let i = 0; i < dim; i += 1) {
      mean[i] += row[i];
    }
  }
  for (let i = 0; i < dim; i += 1) {
    mean[i] /= matrix.length;
  }
  for (const row of matrix) {
    for (let i = 0; i < dim; i += 1) {
      const delta = row[i] - mean[i];
      std[i] += delta * delta;
    }
  }
  for (let i = 0; i < dim; i += 1) {
    std[i] = Math.sqrt(std[i] / matrix.length);
    if (std[i] < 1e-6) {
      std[i] = 1;
    }
  }
  return matrix.map((row) => row.map((val, idx) => (val - mean[idx]) / std[idx]));
}

function smooth(values: number[], window: number) {
  if (values.length === 0 || window <= 1) {
    return values.slice();
  }
  const half = Math.floor(window / 2);
  const out = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    let acc = 0;
    let count = 0;
    for (let j = -half; j <= half; j += 1) {
      const idx = Math.min(values.length - 1, Math.max(0, i + j));
      acc += values[idx];
      count += 1;
    }
    out[i] = acc / count;
  }
  return out;
}

export function computeSections(bars: Quantum[], segments: Segment[], duration: number) {
  if (bars.length <= 1) {
    return makeQuanta([0], duration, [1]);
  }
  const features: number[][] = [];
  for (const bar of bars) {
    const start = bar.start;
    const end = bar.start + bar.duration;
    const overlaps = segments.filter(
      (seg) => seg.start < end && seg.start + seg.duration > start
    );
    if (overlaps.length === 0) {
      features.push(new Array(25).fill(0));
      continue;
    }
    const pitches = new Array(12).fill(0);
    const timbre = new Array(12).fill(0);
    let loudSum = 0;
    for (const seg of overlaps) {
      for (let i = 0; i < 12; i += 1) {
        pitches[i] += seg.pitches[i] ?? 0;
        timbre[i] += seg.timbre[i] ?? 0;
      }
      loudSum += (seg.loudness_start + seg.loudness_max) * 0.5;
    }
    for (let i = 0; i < 12; i += 1) {
      pitches[i] /= overlaps.length;
      timbre[i] /= overlaps.length;
    }
    const loudness = loudSum / overlaps.length;
    features.push([...pitches, ...timbre, loudness]);
  }

  const z = zscore(features);
  const diffs: number[] = [];
  for (let i = 1; i < z.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < z[i].length; j += 1) {
      const delta = z[i][j] - z[i - 1][j];
      sum += delta * delta;
    }
    diffs.push(Math.sqrt(sum));
  }
  const smoothed = smooth(diffs, 3);

  const candidates: number[] = [];
  for (let i = 1; i < smoothed.length - 1; i += 1) {
    if (smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
      candidates.push(i);
    }
  }
  candidates.sort((a, b) => smoothed[b] - smoothed[a]);
  const selected: number[] = [];
  const minGap = 8;
  for (const idx of candidates) {
    const barIndex = idx + 1;
    if (selected.every((s) => Math.abs(barIndex - s) >= minGap)) {
      selected.push(barIndex);
    }
  }
  selected.sort((a, b) => a - b);

  const maxSections = 12;
  const maxBoundaries = maxSections - 1;
  if (selected.length > maxBoundaries) {
    selected.sort((a, b) => smoothed[b - 1] - smoothed[a - 1]);
    selected.length = maxBoundaries;
    selected.sort((a, b) => a - b);
  }

  const sectionStarts = [bars[0].start, ...selected.map((idx) => bars[idx].start)];
  const sectionConfidences: number[] = [];
  let barIndex = 0;
  for (let i = 0; i < sectionStarts.length; i += 1) {
    const start = sectionStarts[i];
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : duration;
    const confidences: number[] = [];
    while (barIndex < bars.length && bars[barIndex].start < end) {
      if (bars[barIndex].start >= start) {
        if (bars[barIndex].confidence !== undefined) {
          confidences.push(bars[barIndex].confidence as number);
        }
      }
      barIndex += 1;
    }
    sectionConfidences.push(
      confidences.length > 0
        ? confidences.reduce((acc, v) => acc + v, 0) / confidences.length
        : 1
    );
  }
  return makeQuanta(sectionStarts, duration, sectionConfidences);
}
