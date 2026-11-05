import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const trackCache = vi.hoisted(() => ({
  readRenderedTrack: vi.fn(),
  writeRenderedTrack: vi.fn(),
  markStoredCopy: vi.fn(),
}));
vi.mock("./renderedTrackCache", () => trackCache);
// Stands in for the worker adapter a render creates when none is passed.
const ownedAdapter = vi.hoisted(() => ({
  stretchSegment: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./rubberBandAdapter", () => ({
  RubberBandWorkerAdapter: class {
    stretchSegment = ownedAdapter.stretchSegment;
    dispose = ownedAdapter.dispose;
  },
}));

import { renderSwingBuffer, renderSwingChannels } from "./swingRenderer";
import { getSwingSignature } from "./swingTiming";
import type { TimeStretchAdapter } from "./timeStretch";

class FakeStretchAdapter implements TimeStretchAdapter {
  calls: Array<{ inputFrames: number; targetFrameCount: number }> = [];

  async stretchSegment(
    channels: Float32Array[],
    _sampleRate: number,
    targetFrameCount: number,
  ): Promise<Float32Array[]> {
    this.calls.push({
      inputFrames: channels[0]?.length ?? 0,
      targetFrameCount,
    });
    return channels.map((channel) => {
      const stretched = new Float32Array(targetFrameCount);
      for (let index = 0; index < targetFrameCount; index += 1) {
        stretched[index] = channel[Math.min(index, channel.length - 1)] ?? 0;
      }
      return stretched;
    });
  }
}

describe("renderSwingChannels", () => {
  it("copies audio outside beats and preserves total frame count", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 10 }, (_, index) => index);

    const [rendered] = await renderSwingChannels(
      [source],
      10,
      [{ start: 0.2, duration: 0.4 }],
      { adapter },
    );

    expect(rendered).toHaveLength(source.length);
    expect(rendered?.[0]).toBe(0);
    expect(rendered?.[1]).toBe(1);
    expect(rendered?.[6]).toBe(6);
    expect(rendered?.[9]).toBe(9);
  });

  it("splits each beat into fixed swing target frame counts", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index);

    await renderSwingChannels(
      [source],
      100,
      [{ start: 0, duration: 1 }],
      { adapter },
    );

    expect(adapter.calls).toEqual([
      { inputFrames: 50, targetFrameCount: 67 },
      { inputFrames: 50, targetFrameCount: 33 },
    ]);
  });

  it("renders all channels with the same output geometry", async () => {
    const adapter = new FakeStretchAdapter();
    const left = Float32Array.from({ length: 20 }, (_, index) => index);
    const right = Float32Array.from({ length: 20 }, (_, index) => index + 100);

    const rendered = await renderSwingChannels(
      [left, right],
      20,
      [{ start: 0, duration: 1 }],
      { adapter },
    );

    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveLength(20);
    expect(rendered[1]).toHaveLength(20);
    expect(adapter.calls).toEqual([
      { inputFrames: 10, targetFrameCount: 13 },
      { inputFrames: 10, targetFrameCount: 7 },
    ]);
  });

  it("reports progress as beat segments complete", async () => {
    const adapter = new FakeStretchAdapter();
    const progress: number[] = [];
    const source = Float32Array.from({ length: 20 }, (_, index) => index);

    await renderSwingChannels(
      [source],
      10,
      [
        { start: 0, duration: 1 },
        { start: 1, duration: 1 },
      ],
      {
        adapter,
        onProgress: (value) => progress.push(value),
      },
    );

    expect(progress).toEqual([0, 0.25, 0.5, 0.75, 1, 1]);
  });

  it("applies a tiny equal-power envelope around rendered joins", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, () => 1);

    const [rendered] = await renderSwingChannels(
      [source],
      1000,
      [{ start: 0, duration: 0.1 }],
      { adapter },
    );

    expect(rendered?.[62]).toBe(1);
    expect(rendered?.[66]).toBeLessThan(1);
    expect(rendered?.[67]).toBeLessThan(1);
    expect(rendered?.[71]).toBe(1);
  });
});

class FailingStretchAdapter extends FakeStretchAdapter {
  constructor(private readonly failingCalls: Set<number> | "all") {
    super();
  }

  override async stretchSegment(
    channels: Float32Array[],
    sampleRate: number,
    targetFrameCount: number,
  ): Promise<Float32Array[]> {
    const call = this.calls.length;
    const result = await super.stretchSegment(channels, sampleRate, targetFrameCount);
    if (this.failingCalls === "all" || this.failingCalls.has(call)) {
      throw new Error(`stretch ${call} failed`);
    }
    return result;
  }
}

// One-second beats across a source of `beatCount` seconds at 100 Hz.
function beatGrid(beatCount: number) {
  return {
    source: Float32Array.from({ length: beatCount * 100 }, (_, index) => index),
    beats: Array.from({ length: beatCount }, (_, index) => ({
      start: index,
      duration: 1,
    })),
  };
}

describe("renderSwingChannels failures and edge beats", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    ownedAdapter.stretchSegment.mockReset();
    ownedAdapter.dispose.mockReset();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("resamples a segment Rubber Band fails on and keeps rendering", async () => {
    const { source, beats } = beatGrid(20);
    const adapter = new FailingStretchAdapter(new Set([3]));

    const [rendered] = await renderSwingChannels([source], 100, beats, {
      adapter,
    });

    expect(adapter.calls).toHaveLength(40);
    expect(rendered).toHaveLength(source.length);
    // Call 3 is beat 1's second half: frames 150..199 resampled into 167..199,
    // where the stretch fake would have copied frame 166 instead.
    expect(rendered?.[183]).toBeCloseTo(150 + (16 * 50) / 33, 4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("fails once fallbacks pass 5% of segments", async () => {
    const { source, beats } = beatGrid(20);
    const adapter = new FailingStretchAdapter(new Set([0, 10, 20]));

    await expect(
      renderSwingChannels([source], 100, beats, { adapter }),
    ).rejects.toThrow("stretch 20 failed");
  });

  it("fails after three consecutive fallbacks", async () => {
    const { source, beats } = beatGrid(100);
    const adapter = new FailingStretchAdapter("all");

    await expect(
      renderSwingChannels([source], 100, beats, { adapter }),
    ).rejects.toThrow("stretch 2 failed");
    expect(adapter.calls).toHaveLength(3);
  });

  it("keeps its own worker adapter after a failed segment", async () => {
    const { source, beats } = beatGrid(20);
    const stretch = new FakeStretchAdapter();
    ownedAdapter.stretchSegment
      .mockRejectedValueOnce(new Error("stretch failed"))
      .mockImplementation(stretch.stretchSegment.bind(stretch));

    await renderSwingChannels([source], 100, beats);

    // Only when the render finishes; a crashed worker replaces itself.
    expect(ownedAdapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips beats with non-finite or non-positive timing", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index);

    await renderSwingChannels(
      [source],
      100,
      [
        { start: Number.NaN, duration: 0.2 },
        { start: 0, duration: Number.NaN },
        { start: 0, duration: -0.5 },
        { start: 0, duration: 0 },
        { start: 0.2, duration: 0.4 },
      ],
      { adapter },
    );

    expect(adapter.calls).toHaveLength(2);
  });

  it("keeps a beat's full swing timing when it runs past the end", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index);

    // 0.8-1.1 s on a 1 s source: the first half (15 -> 20 frames) ends exactly
    // at the end, so the second half is pushed out entirely and not stretched.
    const [rendered] = await renderSwingChannels(
      [source],
      100,
      [{ start: 0.8, duration: 0.3 }],
      { adapter },
    );

    expect(adapter.calls).toEqual([
      { inputFrames: 15, targetFrameCount: 20 },
    ]);
    expect(rendered).toHaveLength(100);
  });

  it("clips a stretched half at the end at its own stretch ratio", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index);

    // 0.85-1.1 s: the first half stretches 12 -> 17 frames from frame 85, so
    // only 15 output frames fit; 11 input frames keep that ratio.
    await renderSwingChannels(
      [source],
      100,
      [{ start: 0.85, duration: 0.25 }],
      { adapter },
    );

    expect(adapter.calls).toEqual([
      { inputFrames: 11, targetFrameCount: 15 },
    ]);
  });

  it("renders when a beat's second half would start past the end", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index);

    const [rendered] = await renderSwingChannels(
      [source],
      100,
      [{ start: 0.9, duration: 0.4 }],
      { adapter },
    );

    expect(adapter.calls).toEqual([
      { inputFrames: 7, targetFrameCount: 10 },
    ]);
    expect(rendered).toHaveLength(100);
  });

  it("reads silence past the end instead of replaying the tail", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index + 1);

    // Negative swing slows the second half, so its output reaches the end
    // before its input does; the input it needs from past the end is silent.
    const [rendered] = await renderSwingChannels(
      [source],
      100,
      [{ start: 0.8, duration: 0.3 }],
      { adapter, swingAmount: -0.5 },
    );

    const [, second] = adapter.calls;
    expect(second!.targetFrameCount).toBe(100 - 80 - adapter.calls[0]!.targetFrameCount);
    expect(Array.from(rendered!.slice(96))).toEqual([0, 0, 0, 0]);
  });

  it("skips a beat that starts before the source", async () => {
    const adapter = new FakeStretchAdapter();
    const source = Float32Array.from({ length: 100 }, (_, index) => index);

    await renderSwingChannels(
      [source],
      100,
      [{ start: -0.1, duration: 0.3 }],
      { adapter },
    );

    expect(adapter.calls).toEqual([]);
  });
});

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

  copyToChannel(data: Float32Array, index: number) {
    this.channels[index].set(data);
  }
}

function createSource(numberOfChannels: number) {
  const source = new FakeAudioBuffer({
    length: 20,
    numberOfChannels,
    sampleRate: 20,
  });
  source.channels.forEach((channel, channelIndex) => {
    channel.set(Float32Array.from({ length: 20 }, (_, i) => i + channelIndex));
  });
  return source as unknown as AudioBuffer;
}

describe("renderSwingBuffer storage", () => {
  const beats = [{ start: 0, duration: 1 }];
  const key = {
    kind: "swing",
    trackId: "track-1",
    signature: getSwingSignature(beats),
  };

  beforeEach(() => {
    trackCache.readRenderedTrack.mockReset().mockResolvedValue(null);
    trackCache.writeRenderedTrack.mockReset().mockResolvedValue(undefined);
    trackCache.markStoredCopy.mockReset();
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the track's stored render instead of stretching", async () => {
    trackCache.readRenderedTrack.mockResolvedValue([
      new Float32Array(21).fill(0.25),
      new Float32Array(21).fill(0.75),
    ]);
    const adapter = new FakeStretchAdapter();
    const onProgress = vi.fn();

    const rendered = await renderSwingBuffer(createSource(2), beats, {
      adapter,
      trackId: "track-1",
      onProgress,
    });

    expect(trackCache.readRenderedTrack).toHaveBeenCalledWith(key, 20, 20);
    expect(adapter.calls).toHaveLength(0);
    expect(trackCache.writeRenderedTrack).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(trackCache.markStoredCopy).toHaveBeenCalledWith(rendered);
    expect(rendered.length).toBe(20);
    expect(rendered.getChannelData(0)[19]).toBe(0.25);
    expect(rendered.getChannelData(1)[0]).toBe(0.75);
  });

  it("stores a fresh render under the track id", async () => {
    const rendered = await renderSwingBuffer(createSource(2), beats, {
      adapter: new FakeStretchAdapter(),
      trackId: "track-1",
    });

    expect(trackCache.writeRenderedTrack).toHaveBeenCalledTimes(1);
    expect(trackCache.markStoredCopy).not.toHaveBeenCalled();
    const [storedKey, channels, sampleRate] =
      trackCache.writeRenderedTrack.mock.calls[0];
    expect(storedKey).toEqual(key);
    expect(sampleRate).toBe(20);
    expect(Array.from(channels[0])).toEqual(
      Array.from(rendered.getChannelData(0)),
    );
    expect(Array.from(channels[1])).toEqual(
      Array.from(rendered.getChannelData(1)),
    );
  });

  it("stores a mono source as two identical channels", async () => {
    await renderSwingBuffer(createSource(1), beats, {
      adapter: new FakeStretchAdapter(),
      trackId: "track-1",
    });
    const [, channels] = trackCache.writeRenderedTrack.mock.calls[0];
    expect(channels[1]).toBe(channels[0]);
  });

  it("skips storage without a track id or beyond stereo", async () => {
    await renderSwingBuffer(createSource(2), beats, {
      adapter: new FakeStretchAdapter(),
    });
    await renderSwingBuffer(createSource(3), beats, {
      adapter: new FakeStretchAdapter(),
      trackId: "track-1",
    });
    expect(trackCache.readRenderedTrack).not.toHaveBeenCalled();
    expect(trackCache.writeRenderedTrack).not.toHaveBeenCalled();
  });

  it("plays but does not store a render that needed a fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { source: samples, beats: gridBeats } = beatGrid(20);
    const source = new FakeAudioBuffer({
      length: samples.length,
      numberOfChannels: 2,
      sampleRate: 100,
    });

    const rendered = await renderSwingBuffer(
      source as unknown as AudioBuffer,
      gridBeats,
      { adapter: new FailingStretchAdapter(new Set([5])), trackId: "track-1" },
    );

    expect(rendered.length).toBe(samples.length);
    expect(trackCache.writeRenderedTrack).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still renders when storage fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    trackCache.readRenderedTrack.mockRejectedValue(new Error("no storage"));
    trackCache.writeRenderedTrack.mockRejectedValue(new Error("quota"));

    const rendered = await renderSwingBuffer(createSource(2), beats, {
      adapter: new FakeStretchAdapter(),
      trackId: "track-1",
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    expect(rendered.length).toBe(20);
    warn.mockRestore();
  });
});
