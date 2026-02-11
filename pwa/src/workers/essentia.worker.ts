// Copied from web/src/workers/essentia.worker.ts on 2026-02-11, reason: reuse essentia.js analysis worker.
import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import wasmUrl from "essentia.js/dist/essentia-wasm.web.wasm?url";

type SegmentationConfig = {
  minSegmentDuration: number;
  noveltySmoothing: number;
  peakThreshold: number;
  peakProminence: number;
  maxSegmentsPerSecond: number;
  beatSnapTolerance: number;
};

type EssentiaWorkerConfig = {
  frameSize: number;
  hopSize: number;
  sampleRate: number;
  segmentation: SegmentationConfig;
};

type AnalyzeMessage = {
  type: "analyze";
  samples: Float32Array;
  sampleRate: number;
  beats: number[];
  config: EssentiaWorkerConfig;
};

type Segment = {
  start: number;
  duration: number;
  confidence: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  pitches: number[];
  timbre: number[];
};

type WorkerResult = {
  segments: Segment[];
};

let essentiaInstance: any = null;

function ensureEssentia() {
  if (essentiaInstance) {
    return essentiaInstance;
  }
  EssentiaWASM.locateFile = () => wasmUrl;
  essentiaInstance = new Essentia(EssentiaWASM);
  return essentiaInstance;
}

function smooth(values: Float32Array, window: number) {
  if (window <= 1 || values.length === 0) {
    return values.slice();
  }
  const windowSize = Math.max(1, window);
  const out = new Float32Array(values.length);
  const half = Math.floor(windowSize / 2);
  const denom = windowSize;
  for (let i = 0; i < values.length; i += 1) {
    let acc = 0;
    for (let j = 0; j < windowSize; j += 1) {
      const idx = Math.min(
        values.length - 1,
        Math.max(0, i - half + j)
      );
      acc += values[idx];
    }
    out[i] = acc / denom;
  }
  return out;
}

function zscore2d(values: number[][]) {
  if (values.length === 0) {
    return values;
  }
  const dim = values[0].length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const row of values) {
    for (let i = 0; i < dim; i += 1) {
      mean[i] += row[i];
    }
  }
  for (let i = 0; i < dim; i += 1) {
    mean[i] /= values.length;
  }
  for (const row of values) {
    for (let i = 0; i < dim; i += 1) {
      const delta = row[i] - mean[i];
      std[i] += delta * delta;
    }
  }
  for (let i = 0; i < dim; i += 1) {
    std[i] = Math.sqrt(std[i] / values.length);
    if (std[i] < 1e-6) {
      std[i] = 1;
    }
  }
  return values.map((row) => row.map((value, idx) => (value - mean[idx]) / std[idx]));
}

function zscore1d(values: number[]) {
  if (values.length === 0) {
    return values;
  }
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  let variance = 0;
  for (const v of values) {
    variance += (v - mean) ** 2;
  }
  const std = Math.sqrt(variance / values.length) || 1;
  return values.map((v) => (v - mean) / std);
}

function findPeaks(
  values: Float32Array,
  height: number,
  prominence: number
) {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (values[i] <= values[i - 1] || values[i] < values[i + 1]) {
      continue;
    }
    if (values[i] < height) {
      continue;
    }
    let leftMin = values[i];
    for (let j = i - 1; j >= 0; j -= 1) {
      leftMin = Math.min(leftMin, values[j]);
      if (values[j] > values[i]) {
        break;
      }
    }
    let rightMin = values[i];
    for (let j = i + 1; j < values.length; j += 1) {
      rightMin = Math.min(rightMin, values[j]);
      if (values[j] > values[i]) {
        break;
      }
    }
    const prom = values[i] - Math.max(leftMin, rightMin);
    if (prom >= prominence) {
      peaks.push(i);
    }
  }
  return peaks;
}

function segmentFromNovelty(
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

function computeSegments(
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

function maybeDeleteVector(value: unknown) {
  if (value && typeof (value as { delete?: () => void }).delete === "function") {
    (value as { delete: () => void }).delete();
  }
}

function vectorToArraySafe(essentia: any, value: unknown) {
  if (value && typeof (value as { size?: () => number }).size === "function") {
    if (typeof essentia.vectorToArray === "function") {
      return essentia.vectorToArray(value as unknown);
    }
  }
  if (value instanceof Float32Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  try {
    return Array.from(value as Iterable<number>);
  } catch {
    return [];
  }
}

self.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data?.type !== "analyze") {
    return;
  }
  try {
    const essentia = ensureEssentia();
    const { samples, sampleRate: sr, config, beats } = event.data;
    const duration = samples.length / sr;
    const frameSize = config.frameSize;
    const hopSize = config.hopSize;
    const frames = Math.max(1, Math.floor(Math.max(samples.length - frameSize, 0) / hopSize) + 1);
    const mfccs: number[][] = [];
    const hpcps: number[][] = [];
    const rmsDb: number[] = [];
    const frameTimes = new Float32Array(frames);

    for (let i = 0; i < frames; i += 1) {
      const start = i * hopSize;
      const frame = new Float32Array(frameSize);
      frame.set(samples.subarray(start, start + frameSize));
      frameTimes[i] = start / sr;

      const frameVec = essentia.arrayToVector(frame);
      const windowed = essentia.Windowing(
        frameVec,
        true,
        frameSize,
        "hann",
        0,
        true
      ).frame;
      const spectrum = essentia.Spectrum(windowed, frameSize).spectrum;
      const mfcc = essentia.MFCC(
        spectrum,
        2,
        11025,
        frameSize / 2 + 1,
        0,
        "dbamp",
        0,
        "unit_sum",
        40,
        13,
        sr
      ).mfcc;
      const maxFreq = Math.min(5000, sr / 2);
      const peaks = essentia.SpectralPeaks(
        spectrum,
        1e-6,
        maxFreq,
        100,
        0,
        "magnitude",
        sr
      );
      let hpcp: unknown;
      if (typeof peaks.frequencies?.size === "function" && peaks.frequencies.size() === 0) {
        hpcp = new Float32Array(12);
      } else {
        hpcp = essentia.HPCP(
          peaks.frequencies,
          peaks.magnitudes,
          true,
          500,
          0,
          maxFreq,
          false,
          40,
          false,
          "unitMax",
          440,
          sr,
          12,
          "squaredCosine",
          1
        ).hpcp;
      }
      const rms = essentia.RMS(frameVec).rms;
      const rmsVal = 20 * Math.log10(rms + 1e-9);

      mfccs.push(vectorToArraySafe(essentia, mfcc));
      hpcps.push(vectorToArraySafe(essentia, hpcp));
      rmsDb.push(rmsVal);

      maybeDeleteVector(frameVec);
      maybeDeleteVector(windowed);
      maybeDeleteVector(spectrum);
      maybeDeleteVector(peaks.frequencies);
      maybeDeleteVector(peaks.magnitudes);
      maybeDeleteVector(hpcp);
      maybeDeleteVector(mfcc);

      if (i % 32 === 0) {
        self.postMessage({
          type: "progress",
          stage: "features",
          progress: Math.min(1, i / frames),
        });
      }
    }

    const mfccNorm = zscore2d(mfccs);
    const hpcpNorm = zscore2d(hpcps);
    const rmsNorm = zscore1d(rmsDb);
    const novelty = new Float32Array(frames);
    novelty[0] = 0;
    for (let i = 1; i < frames; i += 1) {
      let sum = 0;
      const prevMfcc = Array.from(mfccNorm[i - 1] ?? []);
      const prevHpcp = Array.from(hpcpNorm[i - 1] ?? []);
      const curMfcc = Array.from(mfccNorm[i] ?? []);
      const curHpcp = Array.from(hpcpNorm[i] ?? []);
      const vecPrev = prevMfcc.concat(prevHpcp, [rmsNorm[i - 1]]);
      const vecCur = curMfcc.concat(curHpcp, [rmsNorm[i]]);
      for (let j = 0; j < vecCur.length; j += 1) {
        const delta = vecCur[j] - vecPrev[j];
        sum += delta * delta;
      }
      novelty[i] = Math.sqrt(sum);
    }

    self.postMessage({ type: "progress", stage: "segments", progress: 0.5 });

    const boundaries = segmentFromNovelty(
      frameTimes,
      novelty,
      beats,
      config.segmentation,
      duration
    );

    const segments = computeSegments(
      frameTimes,
      mfccs,
      hpcps,
      rmsDb,
      novelty,
      boundaries
    );

    self.postMessage({ type: "progress", stage: "segments", progress: 1 });
    self.postMessage({ type: "result", payload: { segments } satisfies WorkerResult });
  } catch (err) {
    const message =
      err instanceof Error ? err.message || err.toString() : String(err);
    self.postMessage({ type: "error", message });
  }
};
