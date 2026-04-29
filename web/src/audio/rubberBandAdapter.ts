import type { TimeStretchAdapter } from "./timeStretch";

type WorkerRequest = {
  type: "stretch";
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  targetFrameCount: number;
};

type WorkerResponse =
  | {
      type: "result";
      id: number;
      channels: Float32Array[];
    }
  | {
      type: "error";
      id: number;
      message: string;
    };

type PendingRequest = {
  resolve: (channels: Float32Array[]) => void;
  reject: (err: Error) => void;
};

export class RubberBandWorkerAdapter implements TimeStretchAdapter {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  stretchSegment(
    channels: Float32Array[],
    sampleRate: number,
    targetFrameCount: number,
  ): Promise<Float32Array[]> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const requestChannels = channels.map((channel) => new Float32Array(channel));
    const request: WorkerRequest = {
      type: "stretch",
      id,
      channels: requestChannels,
      sampleRate,
      targetFrameCount,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.getWorker().postMessage(
        request,
        requestChannels.map((channel) => channel.buffer),
      );
    });
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Rubber Band worker disposed"));
    }
    this.pending.clear();
  }

  private getWorker() {
    if (this.worker) {
      return this.worker;
    }
    this.worker = new Worker(new URL("./rubberBandWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      this.pending.delete(response.id);
      if (response.type === "error") {
        pending.reject(new Error(response.message));
        return;
      }
      pending.resolve(response.channels);
    };
    this.worker.onerror = () => {
      const err = new Error("Rubber Band worker failed");
      for (const pending of this.pending.values()) {
        pending.reject(err);
      }
      this.pending.clear();
    };
    return this.worker;
  }
}
