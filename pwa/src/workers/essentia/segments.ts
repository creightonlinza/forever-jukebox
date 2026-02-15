import { findPeaks, smooth } from "./math";

export type SegmentationConfig = {
  minSegmentDuration: number;
  noveltySmoothing: number;
  peakThreshold: number;
  peakProminence: number;
  maxSegmentsPerSecond: number;
  beatSnapTolerance: number;
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

export function segmentFromNovelty(
  frameTimes: Float32Array,
  novelty: Float32Array,
  beats: number[],
  config: SegmentationConfig,
  duration: number
) {
  const smoothNovelty = smooth(novelty, Math.max(1, config.noveltySmoothing));
  const peaks = findPeaks(
    smoothNovelty,
    config.peakThreshold,
    config.peakProminence
  );
  const boundaries: number[] = [0];
  for (const idx of peaks) {
    boundaries.push(frameTimes[idx]);
  }
  boundaries.push(duration);

  const snapped: number[] = [0];
  for (let i = 1; i < boundaries.length - 1; i += 1) {
    const t = boundaries[i];
    let nearest = t;
    if (beats.length > 0) {
      let best = beats[0];
      let bestDist = Math.abs(beats[0] - t);
      for (let j = 1; j < beats.length; j += 1) {
        const dist = Math.abs(beats[j] - t);
        if (dist < bestDist) {
          bestDist = dist;
          best = beats[j];
        }
      }
      nearest = best;
    }
    if (Math.abs(nearest - t) <= config.beatSnapTolerance) {
      snapped.push(nearest);
    } else {
      snapped.push(t);
    }
  }
  snapped.push(duration);
  const unique = Array.from(new Set(snapped)).sort((a, b) => a - b);

  const merged: number[] = [unique[0]];
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] - merged[merged.length - 1] < config.minSegmentDuration) {
      continue;
    }
    merged.push(unique[i]);
  }
  if (merged[merged.length - 1] < duration) {
    merged.push(duration);
  }

  const maxSegments = Math.max(1, Math.floor(duration * config.maxSegmentsPerSecond));
  if (merged.length - 1 > maxSegments) {
    const step = Math.max(1, Math.floor((merged.length - 1) / maxSegments));
    const trimmed = [merged[0]];
    for (let i = 1; i < merged.length - 1; i += step) {
      trimmed.push(merged[i]);
    }
    trimmed.push(merged[merged.length - 1]);
    return Array.from(new Set(trimmed)).sort((a, b) => a - b);
  }
  return merged;
}

function segmentConfidence(
  novelty: Float32Array,
  frameTimes: Float32Array,
  start: number
) {
  if (novelty.length === 0) {
    return 0.5;
  }
  let idx = 0;
  while (idx < frameTimes.length && frameTimes[idx] < start) {
    idx += 1;
  }
  idx = Math.min(Math.max(idx, 0), novelty.length - 1);
  let min = novelty[0];
  let max = novelty[0];
  for (let i = 1; i < novelty.length; i += 1) {
    min = Math.min(min, novelty[i]);
    max = Math.max(max, novelty[i]);
  }
  if (max - min < 1e-6) {
    return 0.5;
  }
  return (novelty[idx] - min) / (max - min);
}

export function computeSegments(
  frameTimes: Float32Array,
  mfcc: number[][],
  hpcp: number[][],
  rmsDb: number[],
  novelty: Float32Array,
  boundaries: number[]
) {
  const segments: Segment[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const indices: number[] = [];
    for (let j = 0; j < frameTimes.length; j += 1) {
      const t = frameTimes[j];
      if (t >= start && t < end) {
        indices.push(j);
      }
    }
    if (indices.length === 0) {
      if (frameTimes.length === 0) {
        const zeros = new Array(12).fill(0);
        segments.push({
          start,
          duration: Math.max(0, end - start),
          confidence: 0.5,
          loudness_start: 0,
          loudness_max: 0,
          loudness_max_time: 0,
          pitches: zeros.slice(),
          timbre: zeros.slice(),
        });
        continue;
      }
      let candidate = 0;
      while (candidate < frameTimes.length && frameTimes[candidate] < start) {
        candidate += 1;
      }
      candidate = Math.min(Math.max(candidate, 0), frameTimes.length - 1);
      indices.push(candidate);
    }
    const mfccFrames = indices.map((idx) => mfcc[idx]);
    const hpcpFrames = indices.map((idx) => hpcp[idx]);
    const rmsSeq = indices.map((idx) => rmsDb[idx]);
    const segTimes = indices.map((idx) => frameTimes[idx]);

    const weights = rmsSeq.map((value) => Math.pow(10, value / 20));
    let weightSum = 0;
    if (weights.length > 0) {
      const sorted = [...weights].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(0.1 * (sorted.length - 1))];
      const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
      for (let idx = 0; idx < weights.length; idx += 1) {
        const clipped = Math.min(Math.max(weights[idx], p10), p90);
        weights[idx] = clipped;
        weightSum += clipped;
      }
    }

    const timbre = new Array(12).fill(0);
    if (weightSum > 0) {
      for (let row = 0; row < mfccFrames.length; row += 1) {
        const weight = weights[row];
        const coeffs = mfccFrames[row];
        for (let c = 0; c < 12; c += 1) {
          timbre[c] += weight * (coeffs[c + 1] ?? 0);
        }
      }
      for (let c = 0; c < 12; c += 1) {
        timbre[c] /= weightSum;
      }
    } else if (mfccFrames.length > 0) {
      const mean = new Array(mfccFrames[0].length).fill(0);
      for (const row of mfccFrames) {
        for (let c = 0; c < mean.length; c += 1) {
          mean[c] += row[c] ?? 0;
        }
      }
      for (let c = 0; c < mean.length; c += 1) {
        mean[c] /= mfccFrames.length;
      }
      for (let c = 0; c < 12; c += 1) {
        timbre[c] = mean[c + 1] ?? 0;
      }
    }

    const pitches = new Array(12).fill(0);
    if (hpcpFrames.length > 0) {
      for (const row of hpcpFrames) {
        for (let c = 0; c < 12; c += 1) {
          pitches[c] += row[c] ?? 0;
        }
      }
      for (let c = 0; c < 12; c += 1) {
        pitches[c] /= hpcpFrames.length;
      }
    }
    const maxVal = Math.max(...pitches, 0);
    if (maxVal > 0) {
      for (let c = 0; c < 12; c += 1) {
        pitches[c] /= maxVal;
      }
    }

    const loudnessStart = rmsSeq.length > 0 ? rmsSeq[0] : 0;
    let loudnessMax = loudnessStart;
    let loudnessMaxTime = 0;
    if (rmsSeq.length > 0) {
      loudnessMax = Math.max(...rmsSeq);
      const maxIdx = rmsSeq.indexOf(loudnessMax);
      loudnessMaxTime = (segTimes[maxIdx] ?? start) - start;
    }

    segments.push({
      start,
      duration: Math.max(0, end - start),
      confidence: segmentConfidence(novelty, frameTimes, start),
      loudness_start: loudnessStart,
      loudness_max: loudnessMax,
      loudness_max_time: loudnessMaxTime,
      pitches,
      timbre,
    });
  }
  return segments;
}
