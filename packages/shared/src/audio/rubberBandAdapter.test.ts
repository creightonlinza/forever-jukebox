import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubberBandWorkerAdapter } from "./rubberBandAdapter";

class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    FakeWorker.created.push(this);
  }
}

describe("RubberBandWorkerAdapter", () => {
  beforeEach(() => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects pending work and replaces a worker that crashed", async () => {
    const adapter = new RubberBandWorkerAdapter();
    const pending = adapter.stretchSegment([new Float32Array(4)], 44100, 6);
    const crashed = FakeWorker.created[0]!;

    crashed.onerror?.({ message: "out of memory" } as ErrorEvent);

    await expect(pending).rejects.toThrow(
      "Rubber Band worker failed: out of memory",
    );
    expect(crashed.terminate).toHaveBeenCalled();

    void adapter.stretchSegment([new Float32Array(4)], 44100, 6).catch(() => {});
    expect(FakeWorker.created).toHaveLength(2);
    adapter.dispose();
  });
});
