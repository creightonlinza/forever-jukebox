import { describe, expect, it, vi } from "vitest";
import { AnalyzeAudioUseCase } from "../analyzeAudio";
import { AnalysisPort } from "@/core/domain/ports/AnalysisPort";
import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AudioDecoderPort } from "@/core/domain/ports/AudioDecoderPort";
import { createTestAnalysis } from "@/shared/analysis-schema/testData";

const analysis = createTestAnalysis();

class FakeAudioBuffer {
  length = 4;
  duration = 1;
  sampleRate = 44100;
  numberOfChannels = 1;
  getChannelData() {
    return new Float32Array([0, 0, 0, 0]);
  }
}

function makeDecodedAudio() {
  return {
    audioBuffer: new FakeAudioBuffer() as unknown as AudioBuffer,
    analysisAudio: {
      mono22050: new Float32Array([0, 0, 0, 0]),
      mono44100: new Float32Array([0, 0, 0, 0]),
      duration: 1,
    },
  };
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
      decode: vi.fn(async () => makeDecodedAudio()),
    };

    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);
    const result = await usecase.execute({ file: makeFile() });

    expect(result.analysis).toEqual(analysis);
    expect(result.fromCache).toBe(false);
    expect(analysisPort.analyze).toHaveBeenCalled();
    expect(analysisPort.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        mono22050: expect.any(Float32Array),
        mono44100: expect.any(Float32Array),
        duration: 1,
      })
    );
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
      decode: vi.fn(async () => makeDecodedAudio()),
    };

    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);
    const result = await usecase.execute({ file: makeFile() });

    expect(result.fromCache).toBe(true);
    expect(analysisPort.analyze).not.toHaveBeenCalled();
  });

  it("reports mapped overall progress percentages in monotonic order", async () => {
    const analysisPort: AnalysisPort = {
      analyze: vi.fn(async ({ onProgress }) => {
        onProgress?.({ stage: "beats", progress: 0.4, message: "Detecting beats" });
        onProgress?.({ stage: "features", progress: 0.5, message: "Extracting features" });
        onProgress?.({ stage: "segments", progress: 1, message: "Extracting segments" });
        onProgress?.({ stage: "building", progress: 0.5, message: "Building analysis" });
        return analysis;
      }),
    };
    const cache: AnalysisCachePort = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const decoder: AudioDecoderPort = {
      decode: vi.fn(async () => makeDecodedAudio()),
    };

    const reported: Array<{ stage: string; progress: number }> = [];
    const usecase = new AnalyzeAudioUseCase(analysisPort, cache, decoder);
    await usecase.execute({
      file: makeFile(),
      onProgress: (progress) => {
        reported.push({ stage: progress.stage, progress: progress.progress });
      },
    });

    expect(reported[0]).toEqual({ stage: "loading", progress: 0 });
    expect(reported.some((entry) => entry.stage === "beats" && entry.progress === 40)).toBe(true);
    expect(reported.some((entry) => entry.stage === "segments" && entry.progress === 85)).toBe(
      true
    );
    expect(reported.some((entry) => entry.stage === "building" && entry.progress === 92.5)).toBe(
      true
    );
    expect(reported[reported.length - 1]).toEqual({ stage: "ready", progress: 100 });
    for (let i = 1; i < reported.length; i += 1) {
      expect(reported[i].progress).toBeGreaterThanOrEqual(reported[i - 1].progress);
    }
  });
});
