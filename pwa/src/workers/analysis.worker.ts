// Adapted from web/src/app/browser-analysis.ts on 2026-02-11, reason: move analysis pipeline into a dedicated worker.
import type { TrackMeta } from "@/shared/jukebox/engine/types";
import {
  computeSections,
  computeTempo,
  downmixToMono,
  makeQuanta,
  resampleLinear,
} from "./analysis/helpers";
import type { Quantum, Segment } from "./analysis/helpers";

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

async function runMadmomAnalysis(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<MadmomResult> {
  return new Promise((resolve, reject) => {
    const madmomWorkerUrl = new URL(
      `${import.meta.env.BASE_URL}madmom/worker.js`,
      self.location.origin
    );
    const worker = new Worker(madmomWorkerUrl, { type: "module" });
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
  // Match backend path ordering: decode/downmix -> 22.05k base -> 44.1k for madmom.
  const baseSamples = resampleLinear(mono, sampleRate, ESSENTIA_SAMPLE_RATE);
  const essentiaSamples = baseSamples;
  const madmomSamples = resampleLinear(
    baseSamples,
    ESSENTIA_SAMPLE_RATE,
    MADMOM_SAMPLE_RATE
  );

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
