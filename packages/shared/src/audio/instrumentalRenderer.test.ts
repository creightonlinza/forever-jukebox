import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const trackCache = vi.hoisted(() => ({
  readInstrumentalTrack: vi.fn(),
  writeInstrumentalTrack: vi.fn(),
}));
vi.mock("./instrumentalTrackCache", () => trackCache);

import {
  cancelInstrumentalRender,
  fitInstrumentalChannels,
  isInstrumentalModeAvailable,
  renderInstrumentalBuffer,
} from "./instrumentalRenderer";

class FakeAudioBuffer {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  channels: Float32Array[];

  constructor(options: {
    length: number;
    numberOfChannels: number;
    sampleRate: number;
  }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }

  getChannelData(index: number) {
    return this.channels[index];
  }

  copyToChannel(source: Float32Array, index: number) {
    this.channels[index].set(source);
  }
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(public url: URL) {
    FakeWorker.instances.push(this);
  }
}

function createSource(
  numberOfChannels: number,
  length = 4,
  sampleRate = 44_100,
) {
  return new FakeAudioBuffer({
    length,
    numberOfChannels,
    sampleRate,
  }) as unknown as AudioBuffer;
}

describe("fitInstrumentalChannels", () => {
  it("truncates channels longer than the source", () => {
    const [left, right] = fitInstrumentalChannels(
      2,
      2,
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6]),
    );
    expect(Array.from(left)).toEqual([1, 2]);
    expect(Array.from(right)).toEqual([4, 5]);
  });

  it("zero-pads channels shorter than the source", () => {
    const [left, right] = fitInstrumentalChannels(
      3,
      2,
      new Float32Array([1, 2]),
      new Float32Array([4]),
    );
    expect(Array.from(left)).toEqual([1, 2, 0]);
    expect(Array.from(right)).toEqual([4, 0, 0]);
  });

  it("averages to one channel for mono sources", () => {
    const channels = fitInstrumentalChannels(
      2,
      1,
      new Float32Array([1, 3]),
      new Float32Array([3, 5]),
    );
    expect(channels).toHaveLength(1);
    expect(Array.from(channels[0])).toEqual([2, 4]);
  });

  it("rejects sources with more than two channels", () => {
    expect(() =>
      fitInstrumentalChannels(2, 6, new Float32Array(2), new Float32Array(2)),
    ).toThrow(/mono or stereo/);
  });
});

describe("isInstrumentalModeAvailable", () => {
  const desktop =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is on for a desktop browser with WebGPU", () => {
    vi.stubGlobal("navigator", {
      userAgent: desktop,
      maxTouchPoints: 0,
      gpu: {},
    });
    expect(isInstrumentalModeAvailable()).toBe(true);
  });

  it("is off without WebGPU", () => {
    vi.stubGlobal("navigator", { userAgent: desktop, maxTouchPoints: 0 });
    expect(isInstrumentalModeAvailable()).toBe(false);
  });

  it.each([
    [
      "an Android phone",
      "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
      5,
    ],
    [
      "an iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
      5,
    ],
    ["an iPad reporting a Mac user agent", desktop, 5],
  ])("is off on %s", (_device, userAgent, maxTouchPoints) => {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints, gpu: {} });
    expect(isInstrumentalModeAvailable()).toBe(false);
  });

  it("is off when the browser reports itself as mobile", () => {
    vi.stubGlobal("navigator", {
      userAgent: desktop,
      maxTouchPoints: 0,
      userAgentData: { mobile: true },
      gpu: {},
    });
    expect(isInstrumentalModeAvailable()).toBe(false);
  });
});

describe("renderInstrumentalBuffer", () => {
  beforeEach(() => {
    trackCache.readInstrumentalTrack.mockReset().mockResolvedValue(null);
    trackCache.writeInstrumentalTrack.mockReset().mockResolvedValue(undefined);
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
  });

  afterEach(() => {
    cancelInstrumentalRender();
    vi.unstubAllGlobals();
  });

  it("renders a buffer matching the source geometry", async () => {
    const source = createSource(2, 3);
    const onProgress = vi.fn();
    const pending = renderInstrumentalBuffer(source, null, onProgress);
    const worker = FakeWorker.instances[0];
    expect(worker.url.href).toMatch(/instrumentalWorker\.ts$/);
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({
      type: "separate",
      sampleRate: 44_100,
    });

    worker.onmessage?.({
      data: { type: "progress", phase: "separate", progress: 0.5 },
    });
    worker.onmessage?.({
      data: {
        type: "result",
        left: new Float32Array([1, 2, 3, 4]),
        right: new Float32Array([5, 6, 7, 8]),
      },
    });
    const rendered = await pending;

    expect(onProgress).toHaveBeenCalledWith({
      phase: "separate",
      progress: 0.5,
    });
    expect(rendered.length).toBe(3);
    expect(rendered.numberOfChannels).toBe(2);
    expect(rendered.sampleRate).toBe(44_100);
    expect(Array.from(rendered.getChannelData(0))).toEqual([1, 2, 3]);
    expect(Array.from(rendered.getChannelData(1))).toEqual([5, 6, 7]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("joins the render in flight for the same source", () => {
    const source = createSource(2);
    const first = renderInstrumentalBuffer(source, null, vi.fn());
    const second = renderInstrumentalBuffer(source, null, vi.fn());
    first.catch(() => undefined);

    expect(second).toBe(first);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("reuses a finished render for the same source", async () => {
    const source = createSource(2);
    const first = renderInstrumentalBuffer(source, null, vi.fn());
    FakeWorker.instances[0].onmessage?.({
      data: {
        type: "result",
        left: new Float32Array(4),
        right: new Float32Array(4),
      },
    });
    const rendered = await first;

    await expect(renderInstrumentalBuffer(source, null, vi.fn())).resolves.toBe(
      rendered,
    );
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("forgets a finished render on cancel", async () => {
    const source = createSource(2);
    const first = renderInstrumentalBuffer(source, null, vi.fn());
    FakeWorker.instances[0].onmessage?.({
      data: {
        type: "result",
        left: new Float32Array(4),
        right: new Float32Array(4),
      },
    });
    await first;
    cancelInstrumentalRender();

    renderInstrumentalBuffer(source, null, vi.fn()).catch(() => undefined);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("lets a model download finish before dropping the worker", async () => {
    const pending = renderInstrumentalBuffer(createSource(2), null, vi.fn());
    const worker = FakeWorker.instances[0];
    worker.onmessage?.({
      data: { type: "progress", phase: "download", progress: 0.5 },
    });
    cancelInstrumentalRender();

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage?.({
      data: { type: "progress", phase: "download", progress: 0.9 },
    });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage?.({
      data: { type: "progress", phase: "download", progress: 1 },
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects and terminates the worker on cancel", async () => {
    const source = createSource(2);
    const pending = renderInstrumentalBuffer(source, null, vi.fn());
    cancelInstrumentalRender();

    await expect(pending).rejects.toThrow(/cancelled/);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);

    renderInstrumentalBuffer(source, null, vi.fn()).catch(() => undefined);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("rejects with the worker's error message", async () => {
    const pending = renderInstrumentalBuffer(createSource(2), null, vi.fn());
    FakeWorker.instances[0].onmessage?.({
      data: { type: "error", message: "WebGPU adapter unavailable" },
    });

    await expect(pending).rejects.toThrow("WebGPU adapter unavailable");
  });

  it("resamples to the separator's rate and back", async () => {
    const renderedRates: number[] = [];
    class FakeOfflineAudioContext {
      constructor(
        public channels: number,
        public length: number,
        public sampleRate: number,
      ) {
        renderedRates.push(sampleRate);
      }
      createBuffer(channels: number, length: number, sampleRate: number) {
        return new FakeAudioBuffer({
          numberOfChannels: channels,
          length,
          sampleRate,
        });
      }
      createBufferSource() {
        return { buffer: null, connect: vi.fn(), start: vi.fn() };
      }
      destination = {};
      async startRendering() {
        return new FakeAudioBuffer({
          numberOfChannels: this.channels,
          length: this.length,
          sampleRate: this.sampleRate,
        });
      }
    }
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
    const source = createSource(2, 480, 48_000);

    const pending = renderInstrumentalBuffer(source, null, vi.fn());
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const request = FakeWorker.instances[0].postMessage.mock.calls[0][0];
    expect(request.sampleRate).toBe(44_100);
    expect(request.left).toHaveLength(441);
    FakeWorker.instances[0].onmessage?.({
      data: {
        type: "result",
        left: new Float32Array(441),
        right: new Float32Array(441),
      },
    });
    const rendered = await pending;

    expect(renderedRates).toEqual([44_100, 48_000]);
    expect(rendered.length).toBe(480);
    expect(rendered.sampleRate).toBe(48_000);
  });

  it("uses the track's stored instrumental instead of separating", async () => {
    trackCache.readInstrumentalTrack.mockResolvedValue([
      new Float32Array([1, 2, 3, 4]),
      new Float32Array([5, 6, 7, 8]),
    ]);

    const rendered = await renderInstrumentalBuffer(
      createSource(2),
      "track-1",
      vi.fn(),
    );

    expect(trackCache.readInstrumentalTrack).toHaveBeenCalledWith(
      "track-1",
      4,
      44_100,
    );
    expect(FakeWorker.instances).toHaveLength(0);
    expect(trackCache.writeInstrumentalTrack).not.toHaveBeenCalled();
    expect(Array.from(rendered.getChannelData(0))).toEqual([1, 2, 3, 4]);
    expect(Array.from(rendered.getChannelData(1))).toEqual([5, 6, 7, 8]);
  });

  it("stores a fresh separation under the track id", async () => {
    const pending = renderInstrumentalBuffer(
      createSource(2),
      "track-1",
      vi.fn(),
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const left = new Float32Array([1, 2, 3, 4]);
    const right = new Float32Array([5, 6, 7, 8]);
    FakeWorker.instances[0].onmessage?.({
      data: { type: "result", left, right },
    });
    await pending;

    expect(trackCache.writeInstrumentalTrack).toHaveBeenCalledWith(
      "track-1",
      [left, right],
      44_100,
    );
  });

  it("still renders when storage fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    trackCache.readInstrumentalTrack.mockRejectedValue(new Error("no storage"));
    trackCache.writeInstrumentalTrack.mockRejectedValue(new Error("quota"));
    const pending = renderInstrumentalBuffer(
      createSource(2),
      "track-1",
      vi.fn(),
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    FakeWorker.instances[0].onmessage?.({
      data: {
        type: "result",
        left: new Float32Array(4),
        right: new Float32Array(4),
      },
    });

    await expect(pending).resolves.toBeDefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it("rejects when the worker script fails to load", async () => {
    const pending = renderInstrumentalBuffer(createSource(2), null, vi.fn());
    FakeWorker.instances[0].onerror?.({ message: "" });

    await expect(pending).rejects.toThrow(/failed to load/);
  });
});
