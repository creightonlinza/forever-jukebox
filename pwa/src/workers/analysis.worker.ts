// Adapted from web/src/app/browser-analysis.ts on 2026-02-11, reason: move analysis pipeline into a dedicated worker.
import type { TrackMeta } from "@/shared/jukebox/engine/types";
import {
  computeSections,
  computeTempo,
  makeQuanta,
} from "./analysis/helpers";
import type { Quantum, Segment } from "./analysis/helpers";

type AnalysisResult = {
  engine_version: 1;
  engine_origin: "forever-jukebox-pwa";
  sections: Quantum[];
  bars: Quantum[];
  beats: Quantum[];
  tatums: Quantum[];
  segments: Segment[];
  track: TrackMeta;
};

type AnalyzeMessage = {
  type: "analyze";
  mono22050: Float32Array;
  mono44100: Float32Array;
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
  fps: number;
  beat_times: number[];
  beat_numbers: number[];
  beat_confidences: number[];
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

const FRIENDLY_MEMORY_ERROR =
  "Beat detection ran out of memory for this track.";

function postProgress(stage: ProgressStage, progress: number, message?: string) {
  const payload: WorkerMessage = { type: "progress", stage, progress, message };
  self.postMessage(payload);
}

function formatNestedError(context: string, err: unknown) {
  const message = err instanceof Error
    ? err.message || err.toString()
    : String(err);
  if (message.toLowerCase().includes("unreachable")) {
    return `${context}: ${FRIENDLY_MEMORY_ERROR}`;
  }
  return `${context}: ${message}`;
}

type WorkerTaskControls<TResult> = {
  resolve: (result: TResult) => void;
  reject: (error: Error) => void;
};

function runWorkerTask<TMessage, TResult>(options: {
  createWorker: () => Worker;
  payload: unknown;
  transfer?: Transferable[];
  onMessage: (message: TMessage, controls: WorkerTaskControls<TResult>) => void;
  onRuntimeError: (event: ErrorEvent) => Error;
  onMessageError: () => Error;
}): Promise<TResult> {
  const {
    createWorker,
    payload,
    transfer,
    onMessage,
    onRuntimeError,
    onMessageError,
  } = options;
  return new Promise<TResult>((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate();
      done();
    };
    const controls: WorkerTaskControls<TResult> = {
      resolve: (result) => finish(() => resolve(result)),
      reject: (error) => finish(() => reject(error)),
    };
    worker.addEventListener("message", (event: MessageEvent<TMessage>) => {
      onMessage(event.data, controls);
    });
    worker.addEventListener("error", (event) => {
      controls.reject(onRuntimeError(event));
    });
    worker.addEventListener("messageerror", () => {
      controls.reject(onMessageError());
    });
    worker.postMessage(payload, transfer ?? []);
  });
}

async function runMadmomAnalysis(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<MadmomResult> {
  return runWorkerTask<MadmomMessage, MadmomResult>({
    createWorker: () => {
      const madmomWorkerUrl = new URL(
        `${import.meta.env.BASE_URL}madmom/worker.js`,
        self.location.origin,
      );
      return new Worker(madmomWorkerUrl, { type: "module" });
    },
    payload: { type: "analyze", samples, sampleRate },
    transfer: [samples.buffer],
    onMessage: (data, controls) => {
      if (!data) {
        return;
      }
      if (data.type === "progress") {
        if (onProgress) {
          const stageName =
            data.stage === 0
              ? "features"
              : data.stage === 1
                ? "inference"
                : "decode";
          onProgress(stageName, data.progress);
        }
        return;
      }
      if (data.type === "error") {
        controls.reject(
          new Error(
            formatNestedError(
              "Beat detection failed",
              data.message || "Madmom worker error",
            ),
          ),
        );
        return;
      }
      if (data.type === "result") {
        controls.resolve(data.payload);
      }
    },
    onRuntimeError: (event) =>
      new Error(
        formatNestedError(
          "Beat detection worker runtime failure",
          event.message,
        ),
      ),
    onMessageError: () => new Error("Beat detection worker message error"),
  });
}

async function runEssentiaAnalysis(
  samples: Float32Array,
  sampleRate: number,
  beats: number[],
  config: EssentiaWorkerConfig,
  onProgress?: (stage: string, progress: number) => void
): Promise<EssentiaResult> {
  return runWorkerTask<EssentiaMessage, EssentiaResult>({
    createWorker: () =>
      new Worker(new URL("./essentia.worker.ts", import.meta.url), {
        type: "module",
      }),
    payload: { type: "analyze", samples, sampleRate, beats, config },
    transfer: [samples.buffer],
    onMessage: (data, controls) => {
      if (!data) {
        return;
      }
      if (data.type === "progress") {
        onProgress?.(data.stage, data.progress);
        return;
      }
      if (data.type === "error") {
        controls.reject(
          new Error(
            formatNestedError(
              "Feature extraction failed",
              data.message || "Essentia worker error",
            ),
          ),
        );
        return;
      }
      if (data.type === "result") {
        controls.resolve(data.payload);
      }
    },
    onRuntimeError: (event) =>
      new Error(
        formatNestedError(
          "Feature extraction worker runtime failure",
          event.message || "Essentia worker crashed",
        ),
      ),
    onMessageError: () => new Error("Essentia worker message error"),
  });
}

async function analyzeAudio(options: {
  mono22050: Float32Array;
  mono44100: Float32Array;
  duration: number;
  trackMeta?: TrackMeta;
}) {
  const { mono22050, mono44100, duration, trackMeta } = options;
  if (mono22050.length === 0 || mono44100.length === 0) {
    throw new Error("Decoded audio is empty");
  }
  const essentiaSamples = mono22050;
  const madmomSamples = mono44100;

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

  const beatTimes = Array.isArray(madmom.beat_times) ? madmom.beat_times.slice() : [];
  const beatNumbers = Array.isArray(madmom.beat_numbers) ? madmom.beat_numbers.slice() : [];
  const beatConfidences = Array.isArray(madmom.beat_confidences)
    ? madmom.beat_confidences.slice()
    : [];
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
    engine_version: 1,
    engine_origin: "forever-jukebox-pwa",
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
    const message =
      err instanceof Error
        ? `${err.name || "Error"}: ${err.message || "unknown analysis failure"}`
        : String(err);
    const payload: WorkerMessage = { type: "error", message };
    self.postMessage(payload);
  }
};
