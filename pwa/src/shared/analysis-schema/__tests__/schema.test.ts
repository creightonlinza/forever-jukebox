import { describe, expect, it } from "vitest";
import { validateAnalysis } from "../schema";

const analysis = {
  engine_version: 1,
  engine_origin: "forever-jukebox-pwa",
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

describe("analysis schema", () => {
  it("accepts valid analysis", () => {
    expect(validateAnalysis(analysis)).toEqual(analysis);
  });

  it("rejects invalid analysis", () => {
    expect(() => validateAnalysis({})).toThrow();
  });
});
