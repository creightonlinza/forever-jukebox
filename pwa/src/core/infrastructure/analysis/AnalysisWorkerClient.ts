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
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  trackMeta?: TrackMeta;
};

export class AnalysisWorkerClient implements AnalysisPort {
  async analyze(options: {
    channels: Float32Array[];
    sampleRate: number;
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
        channels: options.channels.map((channel) => channel.slice()),
        sampleRate: options.sampleRate,
        duration: options.duration,
        trackMeta: options.trackMeta,
      };

      const transfer = payload.channels.map((channel) => channel.buffer);
      worker.postMessage(payload, transfer);
    });
  }
}
