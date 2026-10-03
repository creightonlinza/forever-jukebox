import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderDubstepRemix = vi.fn();
const disposeAdapter = vi.fn();
vi.mock("./dubstepRenderer", () => ({
  renderDubstepRemix: (...args: unknown[]) => renderDubstepRemix(...args),
}));
vi.mock("../audio/rubberBandAdapter", () => ({
  RubberBandWorkerAdapter: class {
    dispose = disposeAdapter;
  },
}));
vi.mock("../engine/analysis", () => ({
  parseAnalysis: (raw: unknown) => ({ parsed: raw }),
}));
vi.mock("./dubstepSamples", () => ({
  dubstepSampleUrl: (name: string) => `/samples/${name}.webm`,
}));

import { isStoredCopy } from "../audio/renderedTrackCache";
import {
  WUB_MACHINE_ARRANGEMENT,
  renderWubMachineBuffer,
} from "./wubMachineRender";

class FakeBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(index: number) {
    return this.data[index] as Float32Array;
  }
  copyToChannel(source: Float32Array, index: number) {
    this.data[index]?.set(source);
  }
}

function makeContext(sampleRate = 1000) {
  return {
    sampleRate,
    createBuffer: vi.fn(
      (channels: number, length: number, rate: number) =>
        new FakeBuffer(channels, length, rate),
    ),
    decodeAudioData: vi.fn(async () => new FakeBuffer(2, 20, sampleRate)),
  } as unknown as BaseAudioContext;
}

describe("renderWubMachineBuffer", () => {
  beforeEach(() => {
    renderDubstepRemix.mockReset();
    disposeAdapter.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: !url.includes("missing"),
        status: url.includes("missing") ? 404 : 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders with the house arrangement and packs the result", async () => {
    const context = makeContext();
    const source = new FakeBuffer(1, 100, 1000) as unknown as AudioBuffer;
    const channels = [new Float32Array([1, 2]), new Float32Array([3, 4])];
    renderDubstepRemix.mockImplementation(async (...args: unknown[]) => {
      const options = args[3] as {
        loadSample: (name: string) => Promise<Float32Array[]>;
      };
      expect(await options.loadSample("hats")).toHaveLength(2);
      return {
        channels,
        sampleRate: 1000,
        parts: [{ kind: "intro" }],
        stored: false,
      };
    });

    const { buffer, parts } = await renderWubMachineBuffer(
      source,
      context,
      { beats: [] },
      { trackId: "fp" },
    );

    expect(renderDubstepRemix.mock.calls[0]?.[2]).toEqual({
      parsed: { beats: [] },
    });
    expect(renderDubstepRemix.mock.calls[0]?.[3]).toMatchObject({
      ...WUB_MACHINE_ARRANGEMENT,
      trackId: "fp",
    });
    expect(fetch).toHaveBeenCalledWith("/samples/hats.webm", {
      signal: undefined,
    });
    expect(buffer.length).toBe(2);
    expect(buffer.getChannelData(1)).toEqual(new Float32Array([3, 4]));
    expect(parts).toEqual([{ kind: "intro" }]);
    expect(isStoredCopy(buffer)).toBe(false);
    expect(disposeAdapter).toHaveBeenCalledTimes(1);
  });

  it("marks a buffer decoded from the store as a stored copy", async () => {
    renderDubstepRemix.mockResolvedValue({
      channels: [new Float32Array(1), new Float32Array(1)],
      sampleRate: 1000,
      parts: [],
      stored: true,
    });
    const { buffer } = await renderWubMachineBuffer(
      new FakeBuffer(2, 10, 1000) as unknown as AudioBuffer,
      makeContext(),
      {},
    );
    expect(isStoredCopy(buffer)).toBe(true);
  });

  it("fails on a missing sample and still releases the adapter", async () => {
    renderDubstepRemix.mockImplementation(async (...args: unknown[]) => {
      const options = args[3] as {
        loadSample: (name: string) => Promise<Float32Array[]>;
      };
      return options.loadSample("missing");
    });
    await expect(
      renderWubMachineBuffer(
        new FakeBuffer(2, 10, 1000) as unknown as AudioBuffer,
        makeContext(),
        {},
      ),
    ).rejects.toThrow("Sample download failed (404)");
    expect(disposeAdapter).toHaveBeenCalledTimes(1);
  });

  it("rejects empty audio and a sample-rate mismatch before rendering", async () => {
    await expect(
      renderWubMachineBuffer(
        new FakeBuffer(2, 0, 1000) as unknown as AudioBuffer,
        makeContext(),
        {},
      ),
    ).rejects.toThrow("decoded audio");
    await expect(
      renderWubMachineBuffer(
        new FakeBuffer(2, 10, 2000) as unknown as AudioBuffer,
        makeContext(1000),
        {},
      ),
    ).rejects.toThrow("sample rate");
    expect(renderDubstepRemix).not.toHaveBeenCalled();
  });

  it("keeps a caller-provided adapter", async () => {
    renderDubstepRemix.mockResolvedValue({
      channels: [new Float32Array(1), new Float32Array(1)],
      sampleRate: 1000,
      parts: [],
      stored: false,
    });
    const adapter = { stretchSegment: vi.fn() };
    await renderWubMachineBuffer(
      new FakeBuffer(2, 10, 1000) as unknown as AudioBuffer,
      makeContext(),
      {},
      { adapter },
    );
    expect(renderDubstepRemix.mock.calls[0]?.[3]).toMatchObject({ adapter });
    expect(disposeAdapter).not.toHaveBeenCalled();
  });
});
