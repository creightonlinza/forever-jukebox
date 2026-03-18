import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisOutput } from "@/shared/analysis-schema";
import type { JukeboxConfig } from "@/shared/jukebox/engine";
import { exportJukeboxAudio } from "../exporter";
import { planJukeboxPath } from "../plan";
import { renderJukeboxAudio } from "../render";
import {
  concatMp3ChunksWithFfmpeg,
  encodeAudioBufferWithFfmpeg,
} from "@/core/infrastructure/audio/ffmpegAudio";

vi.mock("../plan", () => ({
  planJukeboxPath: vi.fn(),
}));

vi.mock("../render", () => ({
  renderJukeboxAudio: vi.fn(),
}));

vi.mock("@/core/infrastructure/audio/ffmpegAudio", () => ({
  encodeAudioBufferWithFfmpeg: vi.fn(),
  concatMp3ChunksWithFfmpeg: vi.fn(),
}));

const mockAnalysis: AnalysisOutput = {
  sections: [{ start: 0, duration: 2, confidence: 1 }],
  bars: [{ start: 0, duration: 1, confidence: 1 }],
  beats: [{ start: 0, duration: 0.5, confidence: 1 }],
  tatums: [{ start: 0, duration: 0.25, confidence: 1 }],
  segments: [
    {
      start: 0,
      duration: 1,
      confidence: 1,
      loudness_start: 0,
      loudness_max: 0,
      loudness_max_time: 0,
      pitches: new Array(12).fill(0),
      timbre: new Array(12).fill(0),
    },
  ],
};

const mockConfig: JukeboxConfig = {
  maxBranches: 4,
  maxBranchThreshold: 80,
  currentThreshold: 0,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  minRandomBranchChance: 0.18,
  maxRandomBranchChance: 0.5,
  randomBranchChanceDelta: 0.02,
  minLongBranch: 0,
};

describe("exportJukeboxAudio progress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reports stage progress percentages up to 100", async () => {
    vi.mocked(planJukeboxPath).mockReturnValue({
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
      renderDurationSeconds: 4,
    });

    vi.mocked(renderJukeboxAudio).mockImplementation(async (options) => {
      options.onProgress?.(0);
      options.onProgress?.(0.5);
      options.onProgress?.(1);
      return {} as AudioBuffer;
    });

    vi.mocked(encodeAudioBufferWithFfmpeg).mockImplementation(async (_buffer, options) => {
      options.onProgress?.(0);
      options.onProgress?.(0.5);
      options.onProgress?.(1);
      return {
        bytes: new Uint8Array([10, 11]),
        extension: "mp3",
        mimeType: "audio/mpeg",
      };
    });
    vi.mocked(concatMp3ChunksWithFfmpeg).mockImplementation(async (chunks) => ({
      bytes: chunks[0] ?? new Uint8Array([1, 2]),
      extension: "mp3",
      mimeType: "audio/mpeg",
    }));

    const events: Array<{ stage: string; percent: number }> = [];

    const result = await exportJukeboxAudio({
      analysis: mockAnalysis,
      sourceBuffer: { duration: 4 } as AudioBuffer,
      config: mockConfig,
      durationSeconds: 4,
      format: "mp3",
      onProgress: (event) => {
        events.push({ stage: event.stage, percent: event.percent });
      },
    });

    expect(result.extension).toBe("mp3");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toEqual({ stage: "planning", percent: 2 });
    expect(events.some((event) => event.stage === "rendering" && event.percent >= 80)).toBe(true);
    expect(events.some((event) => event.stage === "encoding" && event.percent >= 90)).toBe(true);
    expect(events[events.length - 1]).toEqual({ stage: "encoding", percent: 100 });
  });

  it("rejects oversized wav exports with a memory-safe error", async () => {
    vi.mocked(planJukeboxPath).mockReturnValue({
      segments: [
        {
          outputStart: 0,
          sourceStart: 0,
          duration: 6000,
          beatIndex: 0,
          jumped: false,
          jumpFromIndex: null,
        },
      ],
      renderDurationSeconds: 6000,
    });

    await expect(
      exportJukeboxAudio({
        analysis: mockAnalysis,
        sourceBuffer: {
          duration: 6000,
          sampleRate: 44100,
          numberOfChannels: 2,
        } as AudioBuffer,
        config: mockConfig,
        durationSeconds: 6000,
        format: "wav",
      }),
    ).rejects.toThrow(
      "WAV export is too large for browser memory at this duration. Use MP3 for long exports.",
    );
  });
});
