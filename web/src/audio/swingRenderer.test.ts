import { describe, expect, it } from "vitest";
import { renderSwingChannels } from "./swingRenderer";
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
