import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WubMachineController, loopedPosition } from "./WubMachineController";

const viz = vi.hoisted(() => ({
  setVisible: vi.fn(),
  resizeNow: vi.fn(),
  setOnSelect: vi.fn(),
  setData: vi.fn(),
  setLoop: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./WubMachineViz", () => ({
  WubMachineViz: class {
    setVisible = viz.setVisible;
    resizeNow = viz.resizeNow;
    setOnSelect = viz.setOnSelect;
    setData = viz.setData;
    setLoop = viz.setLoop;
    update = viz.update;
    destroy = viz.destroy;
  },
}));

type FakeSource = {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function makeContext() {
  const sources: FakeSource[] = [];
  const gains: Array<{ gain: { value: number } }> = [];
  const context = {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: vi.fn(async () => undefined),
    createGain: vi.fn(() => {
      const gain = {
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
    createBufferSource: vi.fn(() => {
      const source: FakeSource = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
  };
  return { context: context as unknown as AudioContext, sources, gains, raw: context };
}

function makeBuffer(seconds: number) {
  const data = new Float32Array(seconds * 10);
  data[5] = 0.8;
  return {
    duration: seconds,
    length: data.length,
    sampleRate: 10,
    numberOfChannels: 2,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

// Intro 0–10, two parts 10–30, ending 30–38.
const parts = [
  { kind: "intro" as const, label: "intro", start: 0, duration: 10 },
  { kind: "drop" as const, label: "drop", start: 10, duration: 10 },
  { kind: "break" as const, label: "break", start: 20, duration: 10 },
  { kind: "ending" as const, label: "ending", start: 30, duration: 8 },
];

describe("loopedPosition", () => {
  it("advances linearly when not looping", () => {
    expect(loopedPosition(10, 100, false, 13, 90)).toBe(110);
  });

  it("wraps from the loop end back to the loop start", () => {
    expect(loopedPosition(10, 50, true, 13, 90)).toBe(60);
    expect(loopedPosition(10, 80, true, 13, 90)).toBe(13);
    expect(loopedPosition(10, 85, true, 13, 90)).toBe(18);
    expect(loopedPosition(10, 80 + 77 * 3 + 5, true, 13, 90)).toBe(18);
  });

  it("ignores a degenerate loop", () => {
    expect(loopedPosition(0, 50, true, 20, 20)).toBe(50);
  });
});

describe("WubMachineController", () => {
  let frame: FrameRequestCallback | null = null;
  beforeEach(() => {
    vi.clearAllMocks();
    frame = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const { context, sources, gains, raw } = makeContext();
    const controller = new WubMachineController({} as HTMLElement);
    controller.setRemix(makeBuffer(38), context, parts);
    return { controller, context, sources, gains, raw };
  }

  it("derives loop points and peaks from the remix", () => {
    const { controller } = setup();
    expect(controller.isReady()).toBe(true);
    const [peaks, duration, givenParts, loopStart, loopEnd] =
      viz.setData.mock.calls[0] as [Float32Array, number, unknown, number, number];
    expect(duration).toBe(38);
    expect(givenParts).toBe(parts);
    expect(loopStart).toBe(10);
    expect(loopEnd).toBe(30);
    expect(Math.max(...peaks)).toBeCloseTo(0.8);
  });

  it("plays, reports position, pauses and resumes from the same place", () => {
    const { controller, sources, raw } = setup();
    const ticks: number[] = [];
    controller.setOnTick((seconds) => ticks.push(seconds));
    controller.play();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.start).toHaveBeenCalledWith(0, 0);
    expect(sources[0]!.loop).toBe(false);

    raw.currentTime = 4;
    frame?.(0);
    expect(ticks).toEqual([4]);
    expect(controller.getPosition()).toBe(4);

    controller.pause();
    expect(sources[0]!.stop).toHaveBeenCalled();
    raw.currentTime = 9;
    expect(controller.getPosition()).toBe(4);

    controller.play();
    expect(sources[1]!.start).toHaveBeenCalledWith(0, 4);
    raw.currentTime = 10;
    expect(controller.getPosition()).toBe(5);

    controller.stop();
    expect(controller.getPosition()).toBe(0);
  });

  it("loops the body and re-anchors when the loop flag changes mid-play", () => {
    const { controller, sources, raw } = setup();
    controller.setLoop(true);
    controller.play(25);
    const source = sources[0]!;
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(10);
    expect(source.loopEnd).toBe(30);

    raw.currentTime = 8;
    // 25 + 8 = 33 wraps to 13.
    expect(controller.getPosition()).toBe(13);

    controller.setLoop(false);
    expect(source.loop).toBe(false);
    raw.currentTime = 10;
    expect(controller.getPosition()).toBe(15);

    // Past the loop end, turning looping on does not wrap the current pass.
    controller.play(35);
    controller.setLoop(true);
    expect(sources[1]!.loop).toBe(false);
  });

  it("restarts the body when a looping track reaches its end", () => {
    const { controller, sources } = setup();
    const ended = vi.fn();
    controller.setOnEnded(ended);
    controller.setLoop(true);
    controller.play(35);
    sources[0]!.onended?.();
    expect(ended).not.toHaveBeenCalled();
    expect(sources[1]!.start).toHaveBeenCalledWith(0, 10);
  });

  it("reports the end once and ignores stale sources", () => {
    const { controller, sources } = setup();
    const ended = vi.fn();
    controller.setOnEnded(ended);
    controller.play();
    const first = sources[0]!;
    controller.play(5);
    first.onended?.();
    expect(ended).not.toHaveBeenCalled();
    sources[1]!.onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(controller.getPosition()).toBe(0);
  });

  it("applies volume before and after a remix is loaded", () => {
    const { context } = makeContext();
    const controller = new WubMachineController({} as HTMLElement);
    controller.setVolume(0.25);
    controller.setRemix(makeBuffer(38), context, parts);
    controller.play();
    const gain = (context.createGain as ReturnType<typeof vi.fn>).mock
      .results[0]!.value as { gain: { value: number } };
    expect(gain.gain.value).toBe(0.25);
    controller.setVolume(2);
    expect(gain.gain.value).toBe(1);
  });

  it("resumes a suspended context on play", () => {
    const { controller, raw } = setup();
    raw.state = "suspended";
    controller.play();
    expect(raw.resume).toHaveBeenCalled();
  });

  it("stops and clears when the remix is replaced or removed", () => {
    const { controller, sources, context } = setup();
    controller.play();
    controller.setRemix(null, null);
    expect(sources[0]!.stop).toHaveBeenCalled();
    expect(controller.isReady()).toBe(false);
    expect(viz.setData).toHaveBeenLastCalledWith(
      expect.any(Float32Array),
      0,
      [],
      0,
      0,
    );
    controller.play();
    expect(sources).toHaveLength(1);

    controller.setRemix(makeBuffer(20), context, []);
    expect(controller.isReady()).toBe(true);
    controller.play(5);
    expect(sources[1]!.loopEnd).toBe(20);
    controller.destroy();
    expect(viz.destroy).toHaveBeenCalled();
  });

  it("forwards selection and visibility to the viz", () => {
    const { controller } = setup();
    const onSelect = vi.fn();
    controller.setOnSelect(onSelect);
    expect(viz.setOnSelect).toHaveBeenLastCalledWith(onSelect);
    controller.setVisible(true);
    expect(viz.setVisible).toHaveBeenLastCalledWith(true);
    controller.resizeNow();
    expect(viz.resizeNow).toHaveBeenCalled();
  });
});
