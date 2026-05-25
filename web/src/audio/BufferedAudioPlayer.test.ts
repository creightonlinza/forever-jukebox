import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferedAudioPlayer } from "./BufferedAudioPlayer";

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockBiquadNode {
  type: BiquadFilterType = "lowpass";
  frequency = { value: 0 };
  gain = { value: 0 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockConvolverNode {
  buffer: AudioBuffer | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockStereoPannerNode {
  pan = { value: 0 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  destination = {};
  sampleRate = 48_000;
  createdSources: MockSourceNode[] = [];
  createdGains: MockGainNode[] = [];
  createdBiquads: MockBiquadNode[] = [];
  createdConvolvers: MockConvolverNode[] = [];
  createdPanners: MockStereoPannerNode[] = [];
  createGain() {
    const gain = new MockGainNode();
    this.createdGains.push(gain);
    return gain;
  }
  createBiquadFilter() {
    const biquad = new MockBiquadNode();
    this.createdBiquads.push(biquad);
    return biquad;
  }
  createConvolver() {
    const convolver = new MockConvolverNode();
    this.createdConvolvers.push(convolver);
    return convolver;
  }
  createStereoPanner() {
    const panner = new MockStereoPannerNode();
    this.createdPanners.push(panner);
    return panner;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData(channel: number) {
        return data[channel] as Float32Array;
      },
    } as AudioBuffer;
  }
  createBufferSource() {
    const source = new MockSourceNode();
    this.createdSources.push(source);
    return source;
  }
  decodeAudioData(buffer: ArrayBuffer) {
    const audioBuffer = { duration: buffer.byteLength } as AudioBuffer;
    return Promise.resolve(audioBuffer);
  }
  resume = vi.fn().mockResolvedValue(undefined);
  state: AudioContextState = "running";
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(count = 5) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

describe("BufferedAudioPlayer", () => {
  beforeEach(() => {
    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).requestAnimationFrame = vi.fn(() => 1);
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clamps and returns volume", () => {
    const player = new BufferedAudioPlayer();
    player.setVolume(2);
    expect(player.getVolume()).toBe(1);
    player.setVolume(-1);
    expect(player.getVolume()).toBe(0);
  });

  it("plays and pauses when a buffer is loaded", async () => {
    const player = new BufferedAudioPlayer();
    await player.loadBuffer({ duration: 5 } as AudioBuffer);
    player.play();
    expect(player.isPlaying()).toBe(true);
    player.pause();
    expect(player.isPlaying()).toBe(false);
  });

  it("seeks while playing", async () => {
    const player = new BufferedAudioPlayer();
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    player.seek(5);
    expect(player.isPlaying()).toBe(true);
    expect(player.getCurrentTime()).toBeGreaterThanOrEqual(0);
  });

  it("decode loads buffer", async () => {
    const player = new BufferedAudioPlayer();
    await player.decode(new ArrayBuffer(3));
    expect(player.getDuration()).toBe(3);
  });

  it("tracks buffer time using selected playback rate", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    player.setJukeboxAudioMode("nightcore");
    await player.loadBuffer({ duration: 30 } as AudioBuffer);
    player.play();
    context.currentTime = 5;
    expect(player.getCurrentTime()).toBe(6);
  });

  it("builds daycore audio chain with reverb and 0.8 playback rate", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("daycore");
    player.play();

    expect(context.createdConvolvers.length).toBeGreaterThan(0);
    expect(context.createdBiquads.length).toBe(0);
    expect(context.createdBiquads.some((node) => node.type === "highpass")).toBe(false);
    expect(context.createdSources[0]?.playbackRate.value).toBe(0.8);
  });

  it("builds vaporwave chain with lowpass filter and slower playback", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("vaporwave");
    player.play();

    const lowPass = context.createdBiquads.find((node) => node.type === "lowpass");
    expect(lowPass).toBeDefined();
    expect(lowPass?.frequency.value).toBe(1000);
    expect(context.createdSources[0]?.playbackRate.value).toBe(0.65);
    expect(context.createdConvolvers.length).toBeGreaterThan(0);
  });

  it("builds lofi chain with bandpass filter", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("lofi");
    player.play();

    const bandPass = context.createdBiquads.find((node) => node.type === "bandpass");
    expect(bandPass).toBeDefined();
    expect(bandPass?.frequency.value).toBe(2000);
    expect(context.createdSources[0]?.playbackRate.value).toBe(1);
  });

  it("switches swing mode to a rendered buffer without playbackRate slicing", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    const sourceBuffer = { duration: 2 } as AudioBuffer;
    const swingBuffer = { duration: 2 } as AudioBuffer;
    await player.loadBuffer(sourceBuffer);
    player.setRenderedJukeboxAudioBuffer("swing", swingBuffer);
    player.setJukeboxAudioMode("swing");
    player.play();

    expect(player.getPlaybackRate()).toBe(1);
    expect(context.createdSources).toHaveLength(1);
    expect(context.createdSources[0]?.buffer).toBe(swingBuffer);
    expect(context.createdSources[0]?.start).toHaveBeenCalledWith(0, 0, 2);

    player.stop();
  });

  it("keeps normal mode on the continuous source path", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 2 } as AudioBuffer);
    player.play();

    expect(context.createdSources).toHaveLength(1);
    expect(context.createdSources[0]?.start).toHaveBeenCalledWith(0, 0, 2);
  });

  it("starts panning loop for eight_d mode and resets on mode change", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("eight_d");
    player.play();

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    expect(context.createdPanners[0]?.pan.value).toBe(0);

    player.setJukeboxAudioMode("off");
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    expect(context.createdPanners[0]?.pan.value).toBe(0);
  });

  it("waits for resume before starting playback", async () => {
    const context = new MockAudioContext();
    context.state = "suspended";
    const pendingResume = deferred<void>();
    context.resume = vi.fn(() => pendingResume.promise);
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 5 } as AudioBuffer);
    player.play();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.createdSources).toHaveLength(0);
    pendingResume.resolve();
    await flushMicrotasks();
    expect(context.createdSources).toHaveLength(1);
    expect(context.createdSources[0]?.start).toHaveBeenCalledTimes(1);
  });

  it("does not start playback after stop while resume is pending", async () => {
    const context = new MockAudioContext();
    context.state = "suspended";
    const pendingResume = deferred<void>();
    context.resume = vi.fn(() => pendingResume.promise);
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 5 } as AudioBuffer);
    player.play();
    player.stop();
    pendingResume.resolve();
    await flushMicrotasks();
    expect(context.createdSources).toHaveLength(0);
  });

  it("cleans up a replaced pending jump source", async () => {
    const context = new MockAudioContext();
    context.currentTime = 1;
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    expect(context.createdSources).toHaveLength(1);
    expect(player.scheduleJump(2, 1)).toBe(true);
    const firstPending = context.createdSources[1];
    expect(firstPending).toBeDefined();
    expect(player.scheduleJump(3, 1)).toBe(true);
    expect(firstPending?.stop).toHaveBeenCalled();
    expect(firstPending?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("schedules jumps from the current source cursor", async () => {
    const context = new MockAudioContext();
    context.currentTime = 10;
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 10.25;

    expect(player.scheduleJump(2, 1)).toBe(true);

    expect(context.createdSources).toHaveLength(2);
    expect(context.createdSources[1]?.start).toHaveBeenCalledWith(11, 2, 18);
    expect(context.createdSources[0]?.stop).toHaveBeenCalledWith(11);
  });

  it("skips stale jumps that are already past the source boundary", async () => {
    const context = new MockAudioContext();
    context.currentTime = 1;
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 1.01;

    expect(player.scheduleJump(2, 0)).toBe(false);

    expect(context.createdSources).toHaveLength(1);
    expect(context.createdSources[0]?.stop).not.toHaveBeenCalled();
  });

  it("keeps an existing pending jump when a stale replacement is skipped", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;
    expect(player.scheduleJump(2, 2)).toBe(true);
    const pending = context.createdSources[1];

    context.currentTime = 0.5;
    expect(player.scheduleJump(3, 0)).toBe(false);

    expect(context.createdSources).toHaveLength(2);
    expect(pending?.stop).not.toHaveBeenCalled();
    expect(pending?.disconnect).not.toHaveBeenCalled();
  });

  it("cancels a pending scheduled jump", async () => {
    const context = new MockAudioContext();
    context.currentTime = 1;
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    expect(player.scheduleJump(2, 1)).toBe(true);
    const pending = context.createdSources[1];

    player.cancelScheduledJump();

    expect(pending?.stop).toHaveBeenCalled();
    expect(pending?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps a live source when canceling a future scheduled jump", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;
    expect(player.scheduleJump(2, 1)).toBe(true);
    const original = context.createdSources[0];
    const pending = context.createdSources[1];

    player.cancelScheduledJump();

    const replacement = context.createdSources[2];
    expect(pending?.stop).toHaveBeenCalled();
    expect(pending?.disconnect).toHaveBeenCalledTimes(1);
    expect(original?.stop).toHaveBeenCalledWith(0);
    expect(original?.disconnect).toHaveBeenCalledTimes(1);
    expect(replacement?.start).toHaveBeenCalledWith(0.25, 0.25, 9.75);
    expect(player.isPlaying()).toBe(true);
  });

  it("promotes an already-started pending jump instead of canceling audible audio", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    context.currentTime = 0.5;
    expect(player.scheduleJump(2, 1)).toBe(true);
    const pending = context.createdSources[1];

    context.currentTime = 1.01;
    player.cancelScheduledJump();

    expect(pending?.stop).not.toHaveBeenCalled();
    expect(pending?.disconnect).not.toHaveBeenCalled();
    expect(player.getCurrentTime()).toBeCloseTo(2.01, 5);
    expect(player.isPlaying()).toBe(true);
  });
});
