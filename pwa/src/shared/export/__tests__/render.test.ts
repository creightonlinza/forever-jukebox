import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderJukeboxAudio } from "../render";

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(options: {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
  }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.duration = this.length / this.sampleRate;
    this.channels = Array.from(
      { length: this.numberOfChannels },
      () => new Float32Array(this.length),
    );
  }

  getChannelData(channel: number) {
    return this.channels[channel] as Float32Array;
  }

  copyToChannel(data: Float32Array, channel: number) {
    this.getChannelData(channel).set(data);
  }
}

class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class MockNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockSourceNode extends MockNode {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 1 };
  start = vi.fn();
}

class MockBiquadNode extends MockNode {
  type: BiquadFilterType = "lowpass";
  frequency = { value: 0 };
}

class MockGainNode extends MockNode {
  gain = { value: 1 };
}

class MockConvolverNode extends MockNode {
  buffer: AudioBuffer | null = null;
}

class MockStereoPannerNode extends MockNode {
  pan = new MockAudioParam();
}

class MockWaveShaperNode extends MockNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
}

class MockOfflineAudioContext {
  static last: MockOfflineAudioContext | null = null;
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  destination = new MockNode();
  sources: MockSourceNode[] = [];
  gains: MockGainNode[] = [];
  biquads: MockBiquadNode[] = [];
  convolvers: MockConvolverNode[] = [];
  panners: MockStereoPannerNode[] = [];
  waveShapers: MockWaveShaperNode[] = [];

  constructor(
    channelsOrOptions: number | {
      numberOfChannels: number;
      length: number;
      sampleRate: number;
    },
    length?: number,
    sampleRate?: number,
  ) {
    if (typeof channelsOrOptions === "number") {
      this.numberOfChannels = channelsOrOptions;
      this.length = length ?? 1;
      this.sampleRate = sampleRate ?? 44_100;
    } else {
      this.numberOfChannels = channelsOrOptions.numberOfChannels;
      this.length = channelsOrOptions.length;
      this.sampleRate = channelsOrOptions.sampleRate;
    }
    MockOfflineAudioContext.last = this;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer({
      numberOfChannels: channels,
      length,
      sampleRate,
    }) as unknown as AudioBuffer;
  }

  createBufferSource() {
    const source = new MockSourceNode();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createGain() {
    const gain = new MockGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  createBiquadFilter() {
    const biquad = new MockBiquadNode();
    this.biquads.push(biquad);
    return biquad as unknown as BiquadFilterNode;
  }

  createConvolver() {
    const convolver = new MockConvolverNode();
    this.convolvers.push(convolver);
    return convolver as unknown as ConvolverNode;
  }

  createStereoPanner() {
    const panner = new MockStereoPannerNode();
    this.panners.push(panner);
    return panner as unknown as StereoPannerNode;
  }

  createWaveShaper() {
    const shaper = new MockWaveShaperNode();
    this.waveShapers.push(shaper);
    return shaper as unknown as WaveShaperNode;
  }

  async startRendering() {
    return this.createBuffer(
      this.numberOfChannels,
      this.length,
      this.sampleRate,
    );
  }
}

function makeSourceBuffer(values: number[], sampleRate = 4) {
  const buffer = new FakeAudioBuffer({
    numberOfChannels: 1,
    length: values.length,
    sampleRate,
  });
  buffer.getChannelData(0).set(values);
  return buffer as unknown as AudioBuffer;
}

describe("renderJukeboxAudio", () => {
  beforeEach(() => {
    (globalThis as any).AudioBuffer = FakeAudioBuffer;
    (globalThis as any).OfflineAudioContext = MockOfflineAudioContext;
    MockOfflineAudioContext.last = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves direct copy behavior for off mode", async () => {
    const rendered = await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer([1, 2, 3, 4], 8000),
      segments: [
        {
          outputStart: 0,
          sourceStart: 1 / 8000,
          duration: 2 / 8000,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 2 / 8000,
      gain: 0.5,
      audioMode: "off",
    });

    expect(Array.from(rendered.getChannelData(0))).toEqual([1, 1.5]);
    expect(MockOfflineAudioContext.last).toBeNull();
  });

  it("applies rate modes through the offline source", async () => {
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(16_000).fill(1), 8000),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 1.2,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 1,
      gain: 1,
      audioMode: "nightcore",
    });

    const context = MockOfflineAudioContext.last;
    expect(context?.length).toBe(8000);
    expect(context?.sources[0]?.playbackRate.value).toBe(1.2);
    expect(context?.sources[0]?.start).toHaveBeenCalledWith(0, 0, 1.2);
  });

  it("builds filter and reverb nodes for vaporwave", async () => {
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(20).fill(1), 10),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 0.65,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 1,
      gain: 1,
      audioMode: "vaporwave",
    });

    const context = MockOfflineAudioContext.last;
    expect(context?.biquads[0]?.type).toBe("lowpass");
    expect(context?.biquads[0]?.frequency.value).toBe(1000);
    expect(context?.convolvers.length).toBeGreaterThan(0);
  });

  it("builds underwater lowpass nodes", async () => {
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(20).fill(1), 10),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 1,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 1,
      gain: 1,
      audioMode: "underwater",
    });

    const context = MockOfflineAudioContext.last;
    expect(context?.biquads[0]?.type).toBe("lowpass");
    expect(context?.biquads[0]?.frequency.value).toBe(400);
    expect(context?.convolvers).toHaveLength(0);
  });

  it("builds cathedral filter and reverb nodes", async () => {
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(20).fill(1), 10),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 1,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 1,
      gain: 1,
      audioMode: "cathedral",
    });

    const context = MockOfflineAudioContext.last;
    const dryGain = context?.gains[context.gains.length - 3];
    const wetGain = context?.gains[context.gains.length - 2];
    expect(context?.biquads[0]?.type).toBe("highpass");
    expect(context?.biquads[0]?.frequency.value).toBe(150);
    expect(context?.biquads[1]?.type).toBe("lowpass");
    expect(context?.biquads[1]?.frequency.value).toBe(5500);
    expect(context?.convolvers[0]?.buffer?.duration).toBe(4.75);
    expect(dryGain?.gain.value).toBe(0.7);
    expect(wetGain?.gain.value).toBe(0.9);
  });

  it("automates panning for 8D mode", async () => {
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(8).fill(1), 4),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 2,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 2,
      gain: 1,
      audioMode: "eight_d",
    });

    const panner = MockOfflineAudioContext.last?.panners[0];
    expect(panner?.pan.setValueAtTime).toHaveBeenCalled();
  });

  it("builds bitcrusher and lowpass nodes for eight-bit mode", async () => {
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(20).fill(1), 10),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 1,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 1,
      gain: 1,
      audioMode: "eight_bit",
    });

    const context = MockOfflineAudioContext.last;
    const shaper = context?.waveShapers[0];
    const curve = shaper?.curve;
    expect(curve).toBeInstanceOf(Float32Array);
    expect(new Set(Array.from(curve ?? [])).size).toBeLessThanOrEqual(256);
    expect(context?.biquads).toHaveLength(0);
  });

  it("schedules cowbell overlay events deterministically into the offline graph", async () => {
    const cowbell = makeSourceBuffer([0.5, 0.25], 4);
    await renderJukeboxAudio({
      sourceBuffer: makeSourceBuffer(new Array(8).fill(1), 4),
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 1,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      durationSeconds: 1,
      gain: 1,
      audioMode: "cowbell",
      cowbellEvents: [{ outputStart: 0.25, buffer: cowbell, gain: 0.5, pan: -0.2 }],
    });

    const context = MockOfflineAudioContext.last;
    const cowbellSource = context?.sources[1];
    expect(cowbellSource?.buffer).toBe(cowbell);
    expect(cowbellSource?.start).toHaveBeenCalledWith(0.25, 0, 0.5);
    expect(context?.panners[0]?.pan.value).toBe(-0.2);
  });
});
