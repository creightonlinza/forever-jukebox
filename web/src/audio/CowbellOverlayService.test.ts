import { describe, expect, it, vi } from "vitest";
import { CowbellOverlayService } from "./CowbellOverlayService";

class MockGainNode {
  gain = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockStereoPannerNode {
  pan = { value: 0 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  destination = {};
  createdSources: MockSourceNode[] = [];
  createdGains: MockGainNode[] = [];
  createdPanners: MockStereoPannerNode[] = [];
  createGain() {
    const gain = new MockGainNode();
    this.createdGains.push(gain);
    return gain;
  }
  createStereoPanner() {
    const panner = new MockStereoPannerNode();
    this.createdPanners.push(panner);
    return panner;
  }
  createBufferSource() {
    const source = new MockSourceNode();
    this.createdSources.push(source);
    return source;
  }
  decodeAudioData(buffer: ArrayBuffer) {
    return Promise.resolve({ duration: buffer.byteLength } as AudioBuffer);
  }
}

function createFetch(ok = true) {
  return vi.fn(async () => ({
    ok,
    arrayBuffer: async () => new ArrayBuffer(4),
  }));
}

function createRandom(values: number[]) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0.5;
    index += 1;
    return value;
  };
}

async function flushMicrotasks(count = 20) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

const beat = {
  start: 0,
  duration: 0.8,
};

describe("CowbellOverlayService", () => {
  it("scales overlay output by the shared playback volume", () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });

    service.setVolume(0.4);

    expect(context.createdGains[0]?.gain.value).toBe(0.1);
  });

  it("does not schedule cowbells while disabled", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });
    service.handleBeatEnter(0, beat);
    await flushMicrotasks();
    expect(context.createdSources).toHaveLength(0);
  });

  it("schedules a cowbell hit on beat entry when enabled", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      random: createRandom([0.5, 0.2, 0.5, 0.9]),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });
    service.enable();
    await flushMicrotasks();
    service.handleBeatEnter(0, beat);

    expect(context.createdSources).toHaveLength(1);
    expect(context.createdSources[0]?.start).toHaveBeenCalledWith(0);
  });

  it("may schedule a quiet quarter-hit subdivision burst inside the current beat", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      random: createRandom([0.5, 0.2, 0.5, 0.01, 0.5, 0.2, 0.5]),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });
    service.enable();
    await flushMicrotasks();
    service.handleBeatEnter(0, beat);

    expect(context.createdSources).toHaveLength(4);
    expect(context.createdSources[0]?.start).toHaveBeenCalledWith(0);
    expect(context.createdSources[1]?.start).toHaveBeenCalledWith(0.2);
    expect(context.createdSources[2]?.start).toHaveBeenCalledWith(0.4);
    expect(context.createdSources[3]?.start).toHaveBeenCalledWith(0.6000000000000001);
  });

  it("disabling prevents future cowbell events", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      random: createRandom([0.5, 0.2, 0.5, 0.01, 0.5, 0.2, 0.5]),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });
    service.enable();
    await flushMicrotasks();
    service.handleBeatEnter(0, beat);
    service.disable();
    service.handleBeatEnter(1, { start: 0.8, duration: 0.8 });

    expect(service.isEnabled()).toBe(false);
    expect(context.createdSources).toHaveLength(4);
    expect(context.createdSources[1]?.stop).toHaveBeenCalledWith(0);
    expect(context.createdSources[2]?.stop).toHaveBeenCalledWith(0);
    expect(context.createdSources[3]?.stop).toHaveBeenCalledWith(0);
  });

  it("sample load failure leaves playback unaffected", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: vi.fn(async () => {
        throw new Error("no sample");
      }),
      sampleUrls: ["/missing.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });
    service.enable();
    await flushMicrotasks();

    expect(() => service.handleBeatEnter(0, beat)).not.toThrow();
    expect(context.createdSources).toHaveLength(0);
  });

  it("beat changes cancel stale subdivision hits", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      random: createRandom([0.5, 0.2, 0.5, 0.01, 0.5, 0.2, 0.5]),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: [],
      trillSampleUrls: [],
    });
    service.enable();
    await flushMicrotasks();
    service.handleBeatEnter(0, beat);
    context.currentTime = 0.1;
    service.handleBeatEnter(8, { start: 6.4, duration: 0.8 });

    expect(context.createdSources[0]?.stop).not.toHaveBeenCalled();
    expect(context.createdSources[1]?.stop).toHaveBeenCalledWith(0);
    expect(context.createdSources[2]?.stop).toHaveBeenCalledWith(0);
    expect(context.createdSources[3]?.stop).toHaveBeenCalledWith(0);
    expect(context.createdSources.length).toBeLessThanOrEqual(8);
  });

  it("schedules a Walken effect on inferred section entry beats", async () => {
    const context = new MockAudioContext();
    const service = new CowbellOverlayService(context as unknown as AudioContext, {
      fetch: createFetch(),
      random: createRandom([0.5, 0.2, 0.5, 0.9, 0.1, 0.5, 0.5, 0.5]),
      sampleUrls: ["/cowbell.wav"],
      walkenSampleUrls: ["/walken.wav"],
      trillSampleUrls: [],
    });
    service.enable();
    await flushMicrotasks();
    service.setSectionStartBeatIndices([16]);
    service.handleBeatEnter(16, beat);

    expect(context.createdSources).toHaveLength(2);
    expect(context.createdSources[0]?.start).toHaveBeenCalledWith(0);
    expect(context.createdSources[1]?.start).toHaveBeenCalledWith(0);
  });
});
