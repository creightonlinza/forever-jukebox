import { beforeEach, describe, expect, it, vi } from "vitest";
import { BufferedAudioPlayer } from "./BufferedAudioPlayer";

class MockGainNode {
  gain = { value: 1 };
  connect = vi.fn();
}

class MockSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  destination = {};
  createdSources: MockSourceNode[] = [];
  createGain() {
    return new MockGainNode();
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
    player.scheduleJump(2, 0);
    const firstPending = context.createdSources[1];
    expect(firstPending).toBeDefined();
    player.scheduleJump(3, 0);
    expect(firstPending?.stop).toHaveBeenCalled();
    expect(firstPending?.disconnect).toHaveBeenCalledTimes(1);
  });
});
