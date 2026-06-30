import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonizerBeat } from "./AutocanonizerViz";
import { AutocanonizerController } from "./AutocanonizerController";

vi.mock("./AutocanonizerViz", () => ({
  AutocanonizerViz: class AutocanonizerViz {
    setOnSelect() {}
    setVisible() {}
    resizeNow() {}
    setData() {}
    reset() {}
    destroy() {}
    update() {}
    setOtherIndex() {}
  },
}));

type GainStub = GainNode & { gain: { value: number } };
type PannerStub = StereoPannerNode & { pan: { value: number } };

function createAudioContext() {
  const gains: GainStub[] = [];
  const panners: PannerStub[] = [];
  const context = {
    destination: {},
    createGain: () => {
      const gain = {
        gain: { value: 0 },
        connect: vi.fn(),
      } as unknown as GainStub;
      gains.push(gain);
      return gain;
    },
    createStereoPanner: () => {
      const panner = {
        pan: { value: 0 },
        connect: vi.fn(),
      } as unknown as PannerStub;
      panners.push(panner);
      return panner;
    },
  } as unknown as AudioContext;
  return { context, gains, panners };
}

function createBeat(which: number, start: number): CanonizerBeat {
  return {
    which,
    start,
    duration: 0.1,
    confidence: 1,
    overlappingSegments: [],
    parent: null,
    children: [],
    indexInParent: which,
    prev: null,
    next: null,
    other: null,
    otherGain: 1,
    section: 0,
    volume: 1,
    median_volume: 1,
    color: "#fff",
  } as unknown as CanonizerBeat;
}

describe("AutocanonizerController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and clamps stream pans before audio is attached", () => {
    const controller = new AutocanonizerController({} as HTMLElement);
    controller.setStreamPans(-0.25, 0.75);
    const { context, gains, panners } = createAudioContext();

    controller.setAudio({ duration: 30 } as AudioBuffer, context);

    expect(gains[0].gain.value).toBeCloseTo(0.5 * 0.55);
    expect(gains[1].gain.value).toBeCloseTo(0.5 * 0.45);
    expect(panners[0].pan.value).toBeCloseTo(-0.25);
    expect(panners[1].pan.value).toBeCloseTo(0.75);

    controller.setStreamPans(2, -2);
    expect(panners[0].pan.value).toBe(1);
    expect(panners[1].pan.value).toBe(-1);
  });

  it("keeps the shared volume and base mix independent from stream panning", () => {
    const controller = new AutocanonizerController({} as HTMLElement);
    const { context, gains, panners } = createAudioContext();
    controller.setAudio({ duration: 30 } as AudioBuffer, context);

    controller.setVolume(0.8);
    controller.setStreamPans(0.5, -0.25);

    expect(gains[0].gain.value).toBeCloseTo(0.8 * 0.55);
    expect(gains[1].gain.value).toBeCloseTo(0.8 * 0.45);
    expect(panners[0].pan.value).toBeCloseTo(0.5);
    expect(panners[1].pan.value).toBeCloseTo(-0.25);
  });

  it("reports both cursor positions for normal playback", () => {
    const controller = new AutocanonizerController({} as HTMLElement);
    const main = createBeat(0, 12);
    const other = createBeat(1, 34);
    main.other = other;
    const player = {
      reset: vi.fn(),
      stop: vi.fn(),
      playBeat: vi.fn(() => 10),
    };
    const inner = controller as unknown as {
      beats: CanonizerBeat[];
      player: typeof player;
    };
    inner.beats = [main];
    inner.player = player;
    const onBeat = vi.fn();
    controller.setOnBeat(onBeat);

    controller.startAtIndex(0);
    controller.stop();

    expect(onBeat).toHaveBeenCalledWith(0, main, {
      mainSeconds: 12,
      otherSeconds: 34,
    });
  });

  it("holds the main cursor while finish-out advances the other stream", () => {
    vi.useFakeTimers();
    const controller = new AutocanonizerController({} as HTMLElement);
    const first = createBeat(0, 0);
    const second = createBeat(1, 10);
    const final = createBeat(2, 20);
    first.next = second;
    second.prev = first;
    second.next = final;
    final.prev = second;
    final.other = first;
    first.other = first;
    second.other = second;
    const player = {
      reset: vi.fn(),
      stop: vi.fn(),
      stopMain: vi.fn(),
      playBeat: vi.fn(() => 0.1),
      playOtherOnly: vi.fn(() => 0.1),
    };
    const inner = controller as unknown as {
      beats: CanonizerBeat[];
      player: typeof player;
    };
    inner.beats = [first, second, final];
    inner.player = player;
    const onBeat = vi.fn();
    controller.setFinishOutSong(true);
    controller.setOnBeat(onBeat);

    controller.startAtIndex(2);
    vi.advanceTimersByTime(100);
    controller.stop();

    expect(onBeat).toHaveBeenLastCalledWith(1, second, {
      mainSeconds: 20,
      otherSeconds: 10,
    });
  });
});
