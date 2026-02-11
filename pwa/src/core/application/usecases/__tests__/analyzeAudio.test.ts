import { describe, expect, it, vi } from "vitest";
import { AnalyzeAudioUseCase } from "../analyzeAudio";
import { AnalysisPort } from "@/core/domain/ports/AnalysisPort";
import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AudioDecoderPort } from "@/core/domain/ports/AudioDecoderPort";

const analysis = {
  engine_version: 2,
  sections: [{ start: 0, duration: 1, confidence: 1 }],
  bars: [{ start: 0, duration: 1, confidence: 1 }],
  beats: [{ start: 0, duration: 0.5, confidence: 1 }],
  tatums: [{ start: 0, duration: 0.25, confidence: 1 }],
  segments: [
    {
      start: 0,
      duration: 1,
      confidence: 0.5,
      loudness_start: 0,
      loudness_max: 0,
      loudness_max_time: 0,
      pitches: new Array(12).fill(0),
      timbre: new Array(12).fill(0),
    },
  ],
  track: { duration: 1, tempo: 120, time_signature: 4 },
};

class FakeAudioBuffer {
  length = 4;
  duration = 1;
  sampleRate = 44100;
  numberOfChannels = 1;
  getChannelData() {
    return new Float32Array([0, 0, 0, 0]);
  }
}

function makeFile() {
  return new File([new Uint8Array([1, 2, 3])], "song.wav", { lastModified: 1234 });
}

describe("AnalyzeAudioUseCase", () => {
  it("uses analysis port and caches result", async () => {
    const analysisPort: AnalysisPort = {
      analyze: vi.fn(async () => analysis),
    };
    const cache: AnalysisCachePort = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const decoder: AudioDecoderPort = {
      decode: vi.fn(async () => new FakeAudioBuffer() as unknown as AudioBuffer),
    };

    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);
    const result = await usecase.execute({ file: makeFile() });

    expect(result.analysis).toEqual(analysis);
    expect(result.fromCache).toBe(false);
    expect(analysisPort.analyze).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  it("returns cached analysis when available", async () => {
    const analysisPort: AnalysisPort = {
      analyze: vi.fn(async () => analysis),
    };
    const cache: AnalysisCachePort = {
      get: vi.fn(async () => analysis),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const decoder: AudioDecoderPort = {
      decode: vi.fn(async () => new FakeAudioBuffer() as unknown as AudioBuffer),
    };

    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);
    const result = await usecase.execute({ file: makeFile() });

    expect(result.fromCache).toBe(true);
    expect(analysisPort.analyze).not.toHaveBeenCalled();
  });
});
