import { AnalysisPort, AnalysisProgress } from "@/core/domain/ports/AnalysisPort";
import { AnalysisOutput } from "@/shared/analysis-schema";
import { TrackMeta } from "@/shared/jukebox/engine/types";

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
        reject(new Error(event.message || "Analysis worker error"));
      });

      const payload: AnalyzeRequest = {
        type: "analyze",
        mono22050: options.mono22050.slice(),
        mono44100: options.mono44100.slice(),
        duration: options.duration,
        trackMeta: options.trackMeta,
      };

      const transfer = [payload.mono22050.buffer, payload.mono44100.buffer];
      worker.postMessage(payload, transfer);
    });
  }
}
