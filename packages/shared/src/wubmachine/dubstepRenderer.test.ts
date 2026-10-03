import { beforeEach, describe, expect, it, vi } from "vitest";
const trackCache = vi.hoisted(() => ({
  readRenderedTrack: vi.fn(),
  writeRenderedTrack: vi.fn(),
}));
vi.mock("../audio/renderedTrackCache", () => trackCache);

import type { DubstepAnalysis } from "./dubstepArrangement";
import { renderDubstepRemix } from "./dubstepRenderer";
import type { TimeStretchAdapter } from "../audio/timeStretch";

const SAMPLE_RATE = 1000;
// 8 bars at 140 BPM.
const BED_FRAMES = 13714;
const ENDING_FRAMES = 500;

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
    return channels.map(() => new Float32Array(targetFrameCount).fill(1));
  }
}

function makeAnalysis(): DubstepAnalysis {
  const beats = Array.from({ length: 32 }, (_, i) => ({
    start: i * 0.5,
    duration: 0.5,
  }));
  const pitches = new Array<number>(12).fill(0.1);
  pitches[0] = 1;
  return {
    sections: [{ start: 0, duration: 16 }],
    beats,
    segments: beats.map((beat, which) => ({
      start: beat.start + 0.125,
      duration: 0.5,
      confidence: 1,
      loudness_start: -60,
      loudness_max: -10,
      loudness_max_time: 0,
      pitches,
      timbre: new Array<number>(12).fill(0),
      which,
    })),
    track: { duration: 16, tempo: 120, time_signature: 4 },
  };
}

describe("renderDubstepRemix", () => {
  beforeEach(() => {
    trackCache.readRenderedTrack.mockReset().mockResolvedValue(null);
    trackCache.writeRenderedTrack.mockReset().mockResolvedValue(undefined);
  });

  const loadSample = async (path: string) => [
    new Float32Array(
      path.startsWith("splash-ends") ? ENDING_FRAMES : BED_FRAMES,
    ).fill(1),
  ];

  it("stores a render under its track id and reuses it", async () => {
    const source = new Float32Array(16 * SAMPLE_RATE).fill(0.5);
    const first = await renderDubstepRemix([source], SAMPLE_RATE, makeAnalysis(), {
      adapter: new FakeStretchAdapter(),
      loadSample,
      trackId: "track-1",
    });
    const [key, stored] = trackCache.writeRenderedTrack.mock.calls[0]!;
    expect(key).toMatchObject({ kind: "dubstep", trackId: "track-1" });
    expect(stored).toBe(first.channels);

    trackCache.readRenderedTrack.mockResolvedValue(first.channels);
    const adapter = new FakeStretchAdapter();
    const second = await renderDubstepRemix(
      [source],
      SAMPLE_RATE,
      makeAnalysis(),
      { adapter, loadSample, trackId: "track-1" },
    );
    expect(trackCache.readRenderedTrack).toHaveBeenLastCalledWith(
      key,
      null,
      SAMPLE_RATE,
    );
    expect(adapter.calls).toEqual([]);
    expect(second.channels).toBe(first.channels);
    expect(second.parts).toEqual(first.parts);
    expect(first.stored).toBe(false);
    expect(second.stored).toBe(true);
    expect(trackCache.writeRenderedTrack).toHaveBeenCalledTimes(1);
  });

  it("stretches each slice onto the grid when beatGrid is set", async () => {
    const adapter = new FakeStretchAdapter();
    const source = new Float32Array(16 * SAMPLE_RATE).fill(0.5);
    const { channels, parts } = await renderDubstepRemix(
      [source],
      SAMPLE_RATE,
      makeAnalysis(),
      { adapter, loadSample, beatGrid: true },
    );
    // One stretch per distinct slice: 16 intro beats + half and quarter cuts
    // of beats 8, 12 and 14 (whole beats 0 and 4 repeat), then 8 + 4 + 4
    // section beats shared by the drop and the break.
    expect(adapter.calls).toHaveLength(16 + 3 + 16);
    const beat = (60 / 140) * SAMPLE_RATE;
    expect(adapter.calls[0]).toEqual({
      inputFrames: 500,
      targetFrameCount: Math.round(beat),
    });
    expect(adapter.calls[16]).toEqual({
      inputFrames: 250,
      targetFrameCount: Math.round(beat / 2),
    });
    expect(adapter.calls[17]!.targetFrameCount).toBe(Math.round(beat / 4));
    expect(channels[0]).toHaveLength(3 * BED_FRAMES + ENDING_FRAMES);
    expect(parts[1]!.duration).toBeCloseTo(BED_FRAMES / SAMPLE_RATE);
  });

  it("does not touch storage without a track id", async () => {
    await renderDubstepRemix(
      [new Float32Array(16 * SAMPLE_RATE)],
      SAMPLE_RATE,
      makeAnalysis(),
      { adapter: new FakeStretchAdapter(), loadSample },
    );
    expect(trackCache.readRenderedTrack).not.toHaveBeenCalled();
    expect(trackCache.writeRenderedTrack).not.toHaveBeenCalled();
  });

  it("stretches each slice list once and mixes it under the sample beds", async () => {
    const adapter = new FakeStretchAdapter();
    const loaded: string[] = [];
    const source = new Float32Array(16 * SAMPLE_RATE).fill(0.5);

    const { channels, plan, parts } = await renderDubstepRemix(
      [source],
      SAMPLE_RATE,
      makeAnalysis(),
      {
        adapter,
        loadSample: async (path) => {
          loaded.push(path);
          const frames = path.startsWith("splash-ends")
            ? ENDING_FRAMES
            : path.startsWith("splashes")
              ? BED_FRAMES / 2
              : BED_FRAMES + 100;
          return [new Float32Array(frames).fill(1)];
        },
      },
    );

    // Intro and the section's shared slice list: 16s of source at 120 -> 140 BPM.
    expect(adapter.calls).toEqual([
      { inputFrames: 16000, targetFrameCount: 13714 },
      { inputFrames: 16000, targetFrameCount: 13714 },
    ]);
    expect(new Set(loaded).size).toBe(loaded.length);
    expect(channels[0]).toHaveLength(3 * BED_FRAMES + ENDING_FRAMES);
    expect(parts.map((part) => part.kind)).toEqual([
      "intro",
      "drop",
      "break",
      "ending",
    ]);
    expect(parts[3]!.start).toBeCloseTo((3 * BED_FRAMES) / SAMPLE_RATE);
    expect(parts[3]!.duration).toBeCloseTo(ENDING_FRAMES / SAMPLE_RATE);
    expect(channels[1]).toEqual(channels[0]);

    const mix = plan.parts[1]!.mix;
    // Drop: wub + half-length splash averaged, over the stretched source.
    expect(channels[0][BED_FRAMES]).toBeCloseTo(mix + (1 - mix));
    expect(channels[0][2 * BED_FRAMES - 1]).toBeCloseTo(0.5 * mix + (1 - mix));
    // Ending: the sample alone.
    expect(channels[0][3 * BED_FRAMES]).toBe(1);
  });

  it("fills slices past the end of the source with silence on the grid", async () => {
    const adapter = new FakeStretchAdapter();
    // Only the first 4 s of the 16 s the analysis describes exist.
    const source = new Float32Array(4 * SAMPLE_RATE).fill(0.5);
    const { channels, parts } = await renderDubstepRemix(
      [source],
      SAMPLE_RATE,
      makeAnalysis(),
      { adapter, loadSample, beatGrid: true },
    );
    expect(adapter.calls.every((call) => call.inputFrames > 0)).toBe(true);
    expect(adapter.calls.length).toBeLessThan(16 + 3 + 16);
    expect(channels[0]).toHaveLength(3 * BED_FRAMES + ENDING_FRAMES);
    expect(parts.map((part) => part.duration)).toEqual([
      BED_FRAMES / SAMPLE_RATE,
      BED_FRAMES / SAMPLE_RATE,
      BED_FRAMES / SAMPLE_RATE,
      ENDING_FRAMES / SAMPLE_RATE,
    ]);
  });

  it("fits a stretch that comes back the wrong length", async () => {
    const adapter: TimeStretchAdapter = {
      stretchSegment: async (channels) => channels.map((c) => c.slice(0, 10)),
    };
    const { channels, parts, plan } = await renderDubstepRemix(
      [new Float32Array(16 * SAMPLE_RATE).fill(1)],
      SAMPLE_RATE,
      makeAnalysis(),
      { adapter, loadSample },
    );
    expect(channels[0]).toHaveLength(3 * BED_FRAMES + ENDING_FRAMES);
    expect(parts[1]!.start).toBeCloseTo(BED_FRAMES / SAMPLE_RATE);
    // Short stretch: source under the bed for 10 frames, then the bed alone.
    const mix = parts.length ? plan.parts[1]!.mix : 0;
    expect(channels[0][BED_FRAMES + 5]).toBeCloseTo(mix + (1 - mix));
    expect(channels[0][BED_FRAMES + 20]).toBeCloseTo(mix);
  });

  it("aborts between slices and never stores a partial render", async () => {
    const controller = new AbortController();
    const adapter: TimeStretchAdapter = {
      stretchSegment: async (channels, _rate, frames) => {
        controller.abort();
        return channels.map(() => new Float32Array(frames));
      },
    };
    await expect(
      renderDubstepRemix(
        [new Float32Array(16 * SAMPLE_RATE)],
        SAMPLE_RATE,
        makeAnalysis(),
        {
          adapter,
          loadSample,
          beatGrid: true,
          trackId: "track-1",
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("cancelled");
    expect(trackCache.writeRenderedTrack).not.toHaveBeenCalled();
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderDubstepRemix([new Float32Array(100)], SAMPLE_RATE, makeAnalysis(), {
        adapter: new FakeStretchAdapter(),
        loadSample: async () => [new Float32Array(10)],
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
  });
});
