import { AnalysisPort, AnalysisProgress } from "@/core/domain/ports/AnalysisPort";
import { AnalysisOutput } from "@/shared/analysis-schema";
import { TrackMeta } from "@forever-jukebox/shared/types";

type WorkerProgress = {
  type: "progress";
  stage: AnalysisProgress["stage"];
  progress: number;
  message?: string;
};

type WorkerResult = {
  type: "result";
  payload: AnalysisOutput;
};

type WorkerError = {
  type: "error";
  message: string;
};

type WorkerMessage = WorkerProgress | WorkerResult | WorkerError;

type AnalyzeRequest = {
  type: "analyze";
  mono22050: Float32Array;
  mono44100: Float32Array;
  duration: number;
  trackMeta?: TrackMeta;
};

const FRIENDLY_MEMORY_ERROR =
  "Beat detection ran out of memory for this track.";

export class AnalysisWorkerClient implements AnalysisPort {
  async analyze(options: {
    mono22050: Float32Array;
    mono44100: Float32Array;
    duration: number;
    trackMeta?: TrackMeta;
    onProgress?: (progress: AnalysisProgress) => void;
  }): Promise<AnalysisOutput> {
    const worker = new Worker(new URL("../../../workers/analysis.worker.ts", import.meta.url), {
      type: "module",
    });

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.terminate();
      };

      worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
        const data = event.data;
        if (!data) {
          return;
        }
        if (data.type === "progress") {
          options.onProgress?.({
            stage: data.stage,
            progress: data.progress,
            message: data.message,
          });
          return;
        }
        if (data.type === "error") {
          cleanup();
          reject(new Error(data.message));
          return;
        }
        if (data.type === "result") {
          cleanup();
          resolve(data.payload);
        }
      });

      worker.addEventListener("error", (event) => {
        cleanup();
        reject(new Error(formatWorkerRuntimeError(event, "analysis worker")));
      });

      const payload: AnalyzeRequest = {
        type: "analyze",
        // Transfer ownership instead of cloning to avoid duplicate large allocations.
        mono22050: options.mono22050,
        mono44100: options.mono44100,
        duration: options.duration,
        trackMeta: options.trackMeta,
      };

      const transfer = [payload.mono22050.buffer, payload.mono44100.buffer];
      worker.postMessage(payload, transfer);
    });
  }
}

function formatWorkerRuntimeError(event: ErrorEvent, context: string) {
  const base = event.message?.trim() || "unknown worker runtime failure";
  if (base.toLowerCase().includes("unreachable")) {
    return `${context}: ${FRIENDLY_MEMORY_ERROR}`;
  }
  return `${context}: ${base}`;
}
