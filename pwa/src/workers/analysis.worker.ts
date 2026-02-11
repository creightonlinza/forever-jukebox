// Adapted from web/src/app/browser-analysis.ts on 2026-02-11, reason: move analysis pipeline into a dedicated worker.
import type { TrackMeta } from "@/shared/jukebox/engine/types";

type Quantum = {
  start: number;
  duration: number;
  confidence?: number;
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

type AnalysisResult = {
  engine_version: number;
  sections: Quantum[];
  bars: Quantum[];
  beats: Quantum[];
  tatums: Quantum[];
  segments: Segment[];
  track: TrackMeta;
};

type AnalyzeMessage = {
  type: "analyze";
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  trackMeta?: TrackMeta;
};

type WorkerMessage =
  | { type: "progress"; stage: "beats" | "features" | "segments" | "building"; progress: number; message?: string }
  | { type: "result"; payload: AnalysisResult }
  | { type: "error"; message: string };

type ProgressStage = "beats" | "features" | "segments" | "building";

const MADMOM_SAMPLE_RATE = 44100;
const ESSENTIA_SAMPLE_RATE = 22050;
const ESSENTIA_FRAME_SIZE = 2048;
const ESSENTIA_HOP_SIZE = 512;

const DEFAULT_SEGMENTATION = {
  minSegmentDuration: 0.25,
  noveltySmoothing: 8,
  peakThreshold: 0.3,
  peakProminence: 0.2,
  maxSegmentsPerSecond: 2.5,
  beatSnapTolerance: 0.12,
};

type MadmomResult = {
  activations: { fps: number; data: number[][] };
  events: Array<[number, number, number]>;
  meta?: { sample_rate?: number };
};

type EssentiaResult = {
  segments: Segment[];
};

type EssentiaWorkerConfig = {
  frameSize: number;
  hopSize: number;
  sampleRate: number;
  segmentation: typeof DEFAULT_SEGMENTATION;
};

type MadmomMessage =
  | { type: "result"; payload: MadmomResult }
  | { type: "error"; message?: string }
  | { type: "progress"; stage: number; progress: number };

type EssentiaMessage =
  | { type: "result"; payload: EssentiaResult }
  | { type: "error"; message?: string }
  | { type: "progress"; stage: string; progress: number };

function postProgress(stage: ProgressStage, progress: number, message?: string) {
  const payload: WorkerMessage = { type: "progress", stage, progress, message };
  self.postMessage(payload);
}

function downmixToMono(channels: Float32Array[]): Float32Array {
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

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number) {
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

function makeQuanta(starts: number[], duration: number, confidences?: number[]) {
  const out: Quantum[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : duration;
    const q: Quantum = {
      start: starts[i],
      duration: Math.max(0, end - starts[i]),
    };
    if (confidences && confidences[i] !== undefined) {
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

function computeTempo(beatTimes: number[]) {
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

function computeSections(bars: Quantum[], segments: Segment[], duration: number) {
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

async function runMadmomAnalysis(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<MadmomResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/madmom/worker.js", { type: "module" });
    const handleMessage = (event: MessageEvent<MadmomMessage>) => {
      const data = event.data;
      if (!data) {
        return;
      }
      if (data.type === "progress") {
        if (onProgress) {
          const stageName = data.stage === 0 ? "features" : data.stage === 1 ? "inference" : "decode";
          onProgress(stageName, data.progress);
        }
        return;
      }
      if (data.type === "error") {
        worker.terminate();
        reject(new Error(data.message || "Madmom worker error"));
        return;
      }
      if (data.type === "result") {
        worker.terminate();
        resolve(data.payload);
      }
    };
    worker.addEventListener("message", handleMessage);
    const payload = samples.slice();
    worker.postMessage({ type: "analyze", samples: payload, sampleRate }, [payload.buffer]);
  });
}

async function runEssentiaAnalysis(
  samples: Float32Array,
  sampleRate: number,
  beats: number[],
  config: EssentiaWorkerConfig,
  onProgress?: (stage: string, progress: number) => void
): Promise<EssentiaResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./essentia.worker.ts", import.meta.url), {
      type: "module",
    });
    const handleMessage = (event: MessageEvent<EssentiaMessage>) => {
      const data = event.data;
      if (!data) {
        return;
      }
      if (data.type === "progress") {
        onProgress?.(data.stage, data.progress);
        return;
      }
      if (data.type === "error") {
        worker.terminate();
        reject(new Error(data.message || "Essentia worker error"));
        return;
      }
      if (data.type === "result") {
        worker.terminate();
        resolve(data.payload);
      }
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "Essentia worker crashed"));
    });
    worker.addEventListener("messageerror", () => {
      worker.terminate();
      reject(new Error("Essentia worker message error"));
    });
    const payload = samples.slice();
    worker.postMessage(
      { type: "analyze", samples: payload, sampleRate, beats, config },
      [payload.buffer]
    );
  });
}

async function analyzeAudio(options: {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  trackMeta?: TrackMeta;
}) {
  const { channels, sampleRate, duration, trackMeta } = options;
  const mono = downmixToMono(channels);
  const madmomSamples = resampleLinear(mono, sampleRate, MADMOM_SAMPLE_RATE);
  const essentiaSamples = resampleLinear(mono, sampleRate, ESSENTIA_SAMPLE_RATE);

  postProgress("beats", 0.05, "Detecting beats");
  const madmomStageProgress: Record<string, number> = {
    decode: 0,
    features: 0,
    inference: 0,
  };
  const madmomStageWeights: Record<string, number> = {
    decode: 0.2,
    features: 0.6,
    inference: 0.2,
  };
  const madmom = await runMadmomAnalysis(
    madmomSamples,
    MADMOM_SAMPLE_RATE,
    (stage, progress) => {
      const stageKey = stage in madmomStageProgress ? stage : "features";
      madmomStageProgress[stageKey] = Math.max(
        madmomStageProgress[stageKey],
        progress
      );
      const weighted =
        madmomStageProgress.decode * madmomStageWeights.decode +
        madmomStageProgress.features * madmomStageWeights.features +
        madmomStageProgress.inference * madmomStageWeights.inference;
      const pct = weighted * 0.4;
      postProgress("beats", pct, `Detecting beats (${stage})`);
    }
  );

  const beatTimes: number[] = [];
  const beatNumbers: number[] = [];
  const beatConfidences: number[] = [];
  for (const event of madmom.events) {
    beatTimes.push(event[0]);
    beatNumbers.push(event[1]);
    beatConfidences.push(event[2]);
  }
  if (beatTimes.length === 0) {
    beatTimes.push(0);
    beatNumbers.push(1);
    beatConfidences.push(1);
  }

  postProgress("features", 0.1, "Extracting features");
  const essentiaStageProgress: Record<string, number> = {
    features: 0,
    segments: 0,
  };
  const essentiaStageWeights: Record<string, number> = {
    features: 0.7,
    segments: 0.3,
  };
  const essentia = await runEssentiaAnalysis(
    essentiaSamples,
    ESSENTIA_SAMPLE_RATE,
    beatTimes,
    {
      frameSize: ESSENTIA_FRAME_SIZE,
      hopSize: ESSENTIA_HOP_SIZE,
      sampleRate: ESSENTIA_SAMPLE_RATE,
      segmentation: DEFAULT_SEGMENTATION,
    },
    (stage, progress) => {
      const stageKey = stage in essentiaStageProgress ? stage : "features";
      essentiaStageProgress[stageKey] = Math.max(
        essentiaStageProgress[stageKey],
        progress
      );
      const weighted =
        essentiaStageProgress.features * essentiaStageWeights.features +
        essentiaStageProgress.segments * essentiaStageWeights.segments;
      const mappedStage = stageKey === "segments" ? "segments" : "features";
      postProgress(mappedStage, weighted, `Extracting features (${stage})`);
    }
  );

  postProgress("building", 0.5, "Building analysis");
  const beats = makeQuanta(beatTimes, duration, beatConfidences);
  const barStarts: number[] = [];
  const barConfidences: number[] = [];
  for (let i = 0; i < beatTimes.length; i += 1) {
    if (beatNumbers[i] === 1) {
      barStarts.push(beatTimes[i]);
      barConfidences.push(beatConfidences[i]);
    }
  }
  if (barStarts.length === 0) {
    barStarts.push(beatTimes[0]);
    barConfidences.push(beatConfidences[0] ?? 1);
  }
  const bars = makeQuanta(barStarts, duration, barConfidences);

  const tatumStarts: number[] = [];
  const tatumConfidences: number[] = [];
  for (let i = 0; i < beatTimes.length; i += 1) {
    const beat = beatTimes[i];
    const next = i + 1 < beatTimes.length ? beatTimes[i + 1] : duration;
    const beatDuration = Math.max(0, next - beat);
    for (let t = 0; t < 2; t += 1) {
      tatumStarts.push(beat + (beatDuration * t) / 2);
      tatumConfidences.push(beatConfidences[i] ?? 1);
    }
  }
  const tatums = makeQuanta(tatumStarts, duration, tatumConfidences).map((tatum) => ({
    ...tatum,
    start: Math.round(tatum.start * 1000) / 1000,
  }));

  const sections = computeSections(bars, essentia.segments, duration);
  const tempo = computeTempo(beatTimes);

  const result: AnalysisResult = {
    engine_version: 2,
    sections,
    bars,
    beats,
    tatums,
    segments: essentia.segments,
    track: {
      duration,
      tempo,
      time_signature: 4,
      title: trackMeta?.title,
      artist: trackMeta?.artist,
    },
  };

  postProgress("building", 1, "Analysis complete");
  return result;
}

self.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data?.type !== "analyze") {
    return;
  }
  try {
    const analysis = await analyzeAudio(event.data);
    const payload: WorkerMessage = { type: "result", payload: analysis };
    self.postMessage(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload: WorkerMessage = { type: "error", message };
    self.postMessage(payload);
  }
};
