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
  Q = { value: 1 };
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

class MockWaveShaperNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockDynamicsCompressorNode {
  threshold = { value: -24 };
  knee = { value: 30 };
  ratio = { value: 12 };
  attack = { value: 0.003 };
  release = { value: 0.25 };
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
  createdWaveShapers: MockWaveShaperNode[] = [];
  createdCompressors: MockDynamicsCompressorNode[] = [];
  createdBuffers: AudioBuffer[] = [];
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
  createWaveShaper() {
    const shaper = new MockWaveShaperNode();
    this.createdWaveShapers.push(shaper);
    return shaper;
  }
  createDynamicsCompressor() {
    const compressor = new MockDynamicsCompressorNode();
    this.createdCompressors.push(compressor);
    return compressor;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = {
      length,
      duration: length / sampleRate,
      sampleRate,
      numberOfChannels: channels,
      getChannelData(channel: number) {
        return data[channel] as Float32Array;
      },
    } as AudioBuffer;
    this.createdBuffers.push(buffer);
    return buffer;
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

  it("ignores a stale decode that resolves after a newer one", async () => {
    const context = new MockAudioContext();
    const pending: Array<(buffer: AudioBuffer) => void> = [];
    context.decodeAudioData = ((_buffer: ArrayBuffer) =>
      new Promise<AudioBuffer>((resolve) => {
        pending.push(resolve);
      })) as MockAudioContext["decodeAudioData"];
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);

    const first = player.decode(new ArrayBuffer(1));
    const second = player.decode(new ArrayBuffer(2));

    // The newer decode finishes first and wins.
    pending[1]({ duration: 20 } as AudioBuffer);
    await second;
    expect(player.getDuration()).toBe(20);

    // The older decode resolves late; it must not clobber the newer buffer.
    pending[0]({ duration: 10 } as AudioBuffer);
    await first;
    expect(player.getDuration()).toBe(20);
  });

  it("lets a direct loadBuffer supersede an in-flight decode", async () => {
    const context = new MockAudioContext();
    const pending: Array<(buffer: AudioBuffer) => void> = [];
    context.decodeAudioData = ((_buffer: ArrayBuffer) =>
      new Promise<AudioBuffer>((resolve) => {
        pending.push(resolve);
      })) as MockAudioContext["decodeAudioData"];
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);

    const decoding = player.decode(new ArrayBuffer(1));
    await player.loadBuffer({ duration: 42 } as AudioBuffer);

    pending[0]({ duration: 7 } as AudioBuffer);
    await decoding;
    expect(player.getDuration()).toBe(42);
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
    expect(lowPass?.Q.value).toBeCloseTo(Math.SQRT1_2, 10);
    expect(context.createdSources[0]?.playbackRate.value).toBe(0.65);
    expect(context.createdConvolvers.length).toBeGreaterThan(0);
  });

  it("uses flat Butterworth Q for highpass, default Q for bandpass", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("nightcore");

    const highPass = context.createdBiquads.find(
      (node) => node.type === "highpass",
    );
    expect(highPass?.Q.value).toBeCloseTo(Math.SQRT1_2, 10);

    player.setJukeboxAudioMode("lofi");
    const bandPass = context.createdBiquads.find(
      (node) => node.type === "bandpass",
    );
    expect(bandPass?.Q.value).toBe(1);
  });

  it("scales the nightcore chain and rate with intensity", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("nightcore");
    player.setJukeboxAudioModeIntensity(150);
    player.play();

    const highPass = context.createdBiquads
      .filter((node) => node.type === "highpass")
      .at(-1);
    expect(highPass?.frequency.value).toBeCloseTo(150 * 2 ** 0.5, 6);
    expect(context.createdSources[0]?.playbackRate.value).toBeCloseTo(1.3, 10);
    expect(player.getPlaybackRate()).toBeCloseTo(1.3, 10);
  });

  it("scales vaporwave reverb and lowpass with intensity", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("vaporwave");
    player.setJukeboxAudioModeIntensity(50);
    player.play();

    const lowPass = context.createdBiquads
      .filter((node) => node.type === "lowpass")
      .at(-1);
    expect(lowPass?.frequency.value).toBeCloseTo(1000 * 2 ** 0.5, 6);
    expect(context.createdSources[0]?.playbackRate.value).toBeCloseTo(0.825, 10);
    const wetGain = context.createdGains.at(-1);
    expect(wetGain?.gain.value).toBeCloseTo(0.3, 10);
  });

  it("ignores a repeated intensity value without rebuilding the chain", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("nightcore");
    player.setJukeboxAudioModeIntensity(120);
    const biquadCount = context.createdBiquads.length;
    player.setJukeboxAudioModeIntensity(120);
    expect(context.createdBiquads.length).toBe(biquadCount);
  });

  it("stores intensity without rebuilding for unsupported modes and applies it on switch", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("lofi");
    const biquadCount = context.createdBiquads.length;
    player.setJukeboxAudioModeIntensity(150);
    expect(context.createdBiquads.length).toBe(biquadCount);
    const bandPass = context.createdBiquads.find((node) => node.type === "bandpass");
    expect(bandPass?.frequency.value).toBe(2000);

    player.setJukeboxAudioMode("nightcore");
    expect(player.getPlaybackRate()).toBeCloseTo(1.3, 10);
    expect(player.getJukeboxAudioModeIntensity()).toBe(150);
  });

  it("restarts a playing source at the current offset when intensity changes", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 30 } as AudioBuffer);
    player.setJukeboxAudioMode("nightcore");
    player.play();
    context.currentTime = 5;
    const sourcesBefore = context.createdSources.length;

    player.setJukeboxAudioModeIntensity(150);

    expect(context.createdSources.length).toBeGreaterThan(sourcesBefore);
    expect(context.createdSources.at(-1)?.playbackRate.value).toBeCloseTo(1.3, 10);
    expect(player.isPlaying()).toBe(true);
  });

  it("updates chain params in place on an intensity-only change", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("nightcore");
    player.play();
    const biquadCount = context.createdBiquads.length;
    const sourceCount = context.createdSources.length;

    player.setJukeboxAudioModeIntensity(150);

    // no chain teardown/rebuild — the existing filter is rescaled and the
    // source restarts exactly once for the new rate
    expect(context.createdBiquads.length).toBe(biquadCount);
    expect(context.createdSources.length).toBe(sourceCount + 1);
    const highPass = context.createdBiquads
      .filter((node) => node.type === "highpass")
      .at(-1);
    expect(highPass?.frequency.value).toBeCloseTo(150 * 2 ** 0.5, 6);
  });

  it("applies a combined mode+intensity change with a single source restart", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("nightcore", 120);
    player.play();
    const sourceCount = context.createdSources.length;

    player.setJukeboxAudioMode("vaporwave", 80);

    expect(context.createdSources.length).toBe(sourceCount + 1);
    expect(player.getJukeboxAudioModeIntensity()).toBe(80);
    expect(player.getPlaybackRate()).toBeCloseTo(1 + (0.65 - 1) * 0.8, 10);
    expect(context.createdSources.at(-1)?.playbackRate.value).toBeCloseTo(
      1 + (0.65 - 1) * 0.8,
      10,
    );
  });

  it("clamps intensity to the supported range", () => {
    const player = new BufferedAudioPlayer();
    player.setJukeboxAudioModeIntensity(500);
    expect(player.getJukeboxAudioModeIntensity()).toBe(150);
    player.setJukeboxAudioModeIntensity(0);
    expect(player.getJukeboxAudioModeIntensity()).toBe(50);
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

  it("builds underwater chain with heavy lowpass filter", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("underwater");
    player.play();

    const lowPass = context.createdBiquads.find((node) => node.type === "lowpass");
    expect(lowPass).toBeDefined();
    expect(lowPass?.frequency.value).toBe(400);
    expect(context.createdSources[0]?.playbackRate.value).toBe(1);
    expect(context.createdConvolvers.length).toBe(0);
  });

  it("builds cathedral chain with cathedral-style reverb", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.setJukeboxAudioMode("cathedral");
    player.play();

    const reverb = context.createdConvolvers[0];
    const dryGain = context.createdGains[context.createdGains.length - 2];
    const wetGain = context.createdGains[context.createdGains.length - 1];
    const highPass = context.createdBiquads.find((node) => node.type === "highpass");
    const lowPass = context.createdBiquads.find((node) => node.type === "lowpass");
    expect(reverb).toBeDefined();
    expect(reverb?.buffer?.duration).toBe(4.75);
    expect(dryGain?.gain.value).toBe(0.7);
    expect(wetGain?.gain.value).toBe(0.9);
    expect(highPass?.frequency.value).toBe(150);
    expect(lowPass?.frequency.value).toBe(5500);
    expect(context.createdSources[0]?.playbackRate.value).toBe(1);
  });

  it("builds eight-bit chain with bitcrusher and lowpass filter", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    const sourceBuffer = context.createBuffer(1, 8, 48_000) as AudioBuffer;
    sourceBuffer.getChannelData(0).set([-1, -0.5, 0, 0.5, 1, 0.25, -0.25, 0.75]);
    await player.loadBuffer(sourceBuffer);
    player.setJukeboxAudioMode("eight_bit");
    player.play();

    const shaper = context.createdWaveShapers[0];
    const curve = shaper?.curve;
    const lowPass = context.createdBiquads.find((node) => node.type === "lowpass");
    const rendered = context.createdSources[0]?.buffer;
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve?.[0]).toBe(-1);
    expect(curve?.[curve.length - 1]).toBe(1);
    expect(new Set(Array.from(curve ?? [])).size).toBeLessThanOrEqual(256);
    expect(rendered).not.toBe(sourceBuffer);
    expect(
      new Set(Array.from(rendered?.getChannelData(0).slice(0, 6) ?? [])).size,
    ).toBe(1);
    expect(lowPass).toBeUndefined();
    expect(context.createdSources[0]?.playbackRate.value).toBe(1);
  });

  it("renders eight-bit buffers lazily and releases them after switching away", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    const sourceBuffer = context.createBuffer(1, 8, 48_000) as AudioBuffer;
    const createdBeforeLoad = context.createdBuffers.length;

    await player.loadBuffer(sourceBuffer);
    expect(context.createdBuffers).toHaveLength(createdBeforeLoad);

    player.setJukeboxAudioMode("eight_bit");
    expect(context.createdBuffers).toHaveLength(createdBeforeLoad + 1);

    player.setJukeboxAudioMode("off");
    player.setJukeboxAudioMode("eight_bit");
    expect(context.createdBuffers).toHaveLength(createdBeforeLoad + 2);
  });

  it("releases cached reverb impulses after switching away from reverb modes", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);

    player.setJukeboxAudioMode("cathedral");
    expect(context.createdBuffers).toHaveLength(1);

    player.setJukeboxAudioMode("off");
    player.setJukeboxAudioMode("cathedral");
    expect(context.createdBuffers).toHaveLength(2);
  });

  it("clears decoded and rendered buffers on dispose", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    const sourceBuffer = context.createBuffer(1, 8, 48_000) as AudioBuffer;
    await player.loadBuffer(sourceBuffer);
    player.setJukeboxAudioMode("eight_bit");

    await player.dispose();

    expect(player.getBuffer()).toBeNull();
    expect(player.getSourceBuffer()).toBeNull();
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

  it("keeps off mode off the limiter and routes boosting modes through it", () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);

    const limiter = context.createdCompressors[0];
    const masterGain = context.createdGains[0];
    const panner = context.createdPanners[0];
    expect(limiter).toBeDefined();
    expect(limiter?.threshold.value).toBe(0);
    expect(limiter?.knee.value).toBe(0);
    expect(limiter?.ratio.value).toBe(20);
    expect(limiter?.connect).toHaveBeenCalledWith(context.destination);
    expect(panner?.connect).toHaveBeenCalledWith(masterGain);
    // off mode: straight to the destination, limiter not in the path
    expect(masterGain?.connect).toHaveBeenCalledWith(context.destination);
    expect(masterGain?.connect).not.toHaveBeenCalledWith(limiter);

    // a mode that can clip reroutes masterGain through the limiter
    player.setJukeboxAudioMode("daycore");
    expect(masterGain?.disconnect).toHaveBeenCalled();
    expect(masterGain?.connect).toHaveBeenCalledWith(limiter);

    // and switching back to off restores the direct connection
    masterGain?.connect.mockClear();
    player.setJukeboxAudioMode("off");
    expect(masterGain?.connect).toHaveBeenCalledWith(context.destination);
    expect(masterGain?.connect).not.toHaveBeenCalledWith(limiter);
  });

  it("keeps cowbell mode off the limiter", () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);

    const limiter = context.createdCompressors[0];
    const masterGain = context.createdGains[0];
    masterGain?.connect.mockClear();
    player.setJukeboxAudioMode("vaporwave");
    expect(masterGain?.connect).toHaveBeenCalledWith(limiter);

    masterGain?.connect.mockClear();
    player.setJukeboxAudioMode("cowbell");
    expect(masterGain?.connect).toHaveBeenCalledWith(context.destination);
    expect(masterGain?.connect).not.toHaveBeenCalledWith(limiter);
  });

  it("keeps flat-Q filter modes off the limiter", () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);

    const limiter = context.createdCompressors[0];
    const masterGain = context.createdGains[0];
    masterGain?.connect.mockClear();
    player.setJukeboxAudioMode("nightcore");
    expect(masterGain?.connect).not.toHaveBeenCalledWith(limiter);

    player.setJukeboxAudioMode("underwater");
    expect(masterGain?.connect).not.toHaveBeenCalledWith(limiter);
  });

  it("connects master gain directly to destination without compressor support", () => {
    const context = new MockAudioContext();
    (context as { createDynamicsCompressor?: unknown }).createDynamicsCompressor =
      undefined;
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);

    const masterGain = context.createdGains[0];
    const panner = context.createdPanners[0];
    expect(context.createdCompressors).toHaveLength(0);
    expect(panner?.connect).toHaveBeenCalledWith(masterGain);
    expect(masterGain?.connect).toHaveBeenCalledWith(context.destination);

    // still direct even in a mode that would otherwise be limited: the
    // existing destination connection is left in place untouched
    masterGain?.connect.mockClear();
    masterGain?.disconnect.mockClear();
    player.setJukeboxAudioMode("daycore");
    expect(masterGain?.connect).not.toHaveBeenCalled();
    expect(masterGain?.disconnect).not.toHaveBeenCalled();
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

  it("schedules an early stop and reports the stopped source offset", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    const onEnded = vi.fn();
    player.setOnEnded(onEnded);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;

    expect(player.scheduleStop(1)).toBe(true);
    const source = context.createdSources[0];
    expect(source?.stop).toHaveBeenCalledWith(1);

    context.currentTime = 1;
    source?.onended?.();
    expect(player.isPlaying()).toBe(false);
    expect(player.getCurrentTime()).toBe(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the requested source boundary is already late", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    context.currentTime = 1.1;

    expect(player.scheduleStop(1)).toBe(true);
    expect(context.createdSources[0]?.stop).toHaveBeenCalledWith(1.1);
  });

  it("cancels a future scheduled stop by replacing the live source", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;
    expect(player.scheduleStop(1)).toBe(true);
    const original = context.createdSources[0];

    player.cancelScheduledStop();

    const replacement = context.createdSources[1];
    expect(original?.stop).toHaveBeenCalledWith(0);
    expect(original?.disconnect).toHaveBeenCalledTimes(1);
    expect(replacement?.start).toHaveBeenCalledWith(0.25, 0.25, 9.75);
    expect(player.isPlaying()).toBe(true);
  });

  it("clears a scheduled stop when an explicit jump replaces it", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 10 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;
    expect(player.scheduleStop(2)).toBe(true);
    const original = context.createdSources[0];

    expect(player.scheduleJump(4, 1)).toBe(true);

    expect(original?.stop).toHaveBeenCalledWith(0);
    expect(context.createdSources).toHaveLength(3);
    expect(context.createdSources[2]?.start).toHaveBeenCalledWith(1, 4, 6);
  });

  it.each(["seek", "pause", "stop", "dispose"] as const)(
    "clears a scheduled stop on %s",
    async (action) => {
      const context = new MockAudioContext();
      const player = new BufferedAudioPlayer(context as unknown as AudioContext);
      await player.loadBuffer({ duration: 10 } as AudioBuffer);
      player.play();
      context.currentTime = 0.25;
      expect(player.scheduleStop(2)).toBe(true);
      const source = context.createdSources[0];

      if (action === "seek") {
        player.seek(1);
      } else if (action === "pause") {
        player.pause();
      } else if (action === "stop") {
        player.stop();
      } else {
        await player.dispose();
      }

      expect(source?.stop).toHaveBeenCalledWith(0);
    },
  );

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

  it("publishes an explicit jump event only after source promotion", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;

    expect(player.scheduleJump(2, 1)).toBe(true);
    expect(player.consumeJumpEvent()).toBeNull();

    context.currentTime = 1.05;
    expect(player.consumeJumpEvent()).toEqual({
      sourceStartTime: 1,
      targetTime: 2,
    });
    expect(player.consumeJumpEvent()).toBeNull();
  });

  it("can schedule a transport jump without publishing a jump event", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;

    expect(player.scheduleJump(2, 1, null)).toBe(true);
    expect(player.consumeJumpEvent()).toBeNull();

    context.currentTime = 1.05;
    expect(player.consumeJumpEvent()).toBeNull();
  });

  it("publishes the supplied logical jump event after source promotion", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;

    expect(
      player.scheduleJump(2, 1, {
        sourceStartTime: 5,
        targetTime: 2,
      }),
    ).toBe(true);
    expect(player.consumeJumpEvent()).toBeNull();

    context.currentTime = 1.05;
    expect(player.consumeJumpEvent()).toEqual({
      sourceStartTime: 5,
      targetTime: 2,
    });
  });

  it("pre-schedules an anchor fallback jump on the audio clock", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();

    expect(player.setAnchorJump(2, 5)).toBe(true);

    expect(context.createdSources).toHaveLength(2);
    expect(context.createdSources[1]?.start).toHaveBeenCalledWith(5, 2, 18);
    expect(context.createdSources[0]?.stop).toHaveBeenCalledWith(5);

    context.currentTime = 5.25;
    expect(player.getCurrentTime()).toBeCloseTo(2.25, 5);
  });

  it("publishes an anchor fallback jump event only after source promotion", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();

    expect(player.setAnchorJump(2, 5)).toBe(true);
    expect(player.consumeJumpEvent()).toBeNull();

    context.currentTime = 5.25;
    expect(player.consumeJumpEvent()).toEqual({
      sourceStartTime: 5,
      targetTime: 2,
    });
    expect(player.consumeJumpEvent()).toBeNull();
  });

  it("does not stop a due anchor fallback while clearing anchor state", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    expect(player.setAnchorJump(2, 5)).toBe(true);
    const anchorSource = context.createdSources[1];

    context.currentTime = 5.25;
    player.clearAnchorJump();

    expect(anchorSource?.stop).not.toHaveBeenCalledWith(0);
    expect(player.getCurrentTime()).toBeCloseTo(2.25, 5);
    expect(player.isPlaying()).toBe(true);
  });

  it("lets explicit jumps override and chain the stored anchor fallback", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    expect(player.setAnchorJump(2, 5)).toBe(true);
    const firstAnchor = context.createdSources[1];

    expect(player.scheduleJump(3, 1)).toBe(true);

    const explicit = context.createdSources[2];
    const chainedAnchor = context.createdSources[3];
    expect(firstAnchor?.stop).toHaveBeenCalledWith(0);
    expect(firstAnchor?.disconnect).toHaveBeenCalledTimes(1);
    expect(explicit?.start).toHaveBeenCalledWith(1, 3, 17);
    expect(context.createdSources[0]?.stop).toHaveBeenCalledWith(1);
    expect(chainedAnchor?.start).toHaveBeenCalledWith(3, 2, 18);
    expect(explicit?.stop).toHaveBeenCalledWith(3);
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

  it("does not publish canceled or stale jump events", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;
    expect(player.scheduleJump(2, 1)).toBe(true);

    player.cancelScheduledJump();
    context.currentTime = 1.05;
    expect(player.consumeJumpEvent()).toBeNull();

    context.currentTime = 2.01;
    expect(player.scheduleJump(4, 2)).toBe(false);
    expect(player.consumeJumpEvent()).toBeNull();
  });

  it("clears promoted jump events when seeking before consumption", async () => {
    const context = new MockAudioContext();
    const player = new BufferedAudioPlayer(context as unknown as AudioContext);
    await player.loadBuffer({ duration: 20 } as AudioBuffer);
    player.play();
    context.currentTime = 0.25;
    expect(player.scheduleJump(2, 1)).toBe(true);

    context.currentTime = 1.05;
    expect(player.getCurrentTime()).toBeCloseTo(2.05, 5);
    player.seek(0);

    expect(player.consumeJumpEvent()).toBeNull();
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
