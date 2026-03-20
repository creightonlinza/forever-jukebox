import { describe, expect, it } from "vitest";
import { MemoryAnalysisCache } from "../analysisCache";

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

describe("MemoryAnalysisCache", () => {
  it("stores and retrieves analysis", async () => {
    const cache = new MemoryAnalysisCache();
    await cache.set("fingerprint", analysis);
    const stored = await cache.get("fingerprint");
    expect(stored).toEqual(analysis);
  });

  it("clears entries", async () => {
    const cache = new MemoryAnalysisCache();
    await cache.set("fingerprint", analysis);
    await cache.clear("fingerprint");
    const stored = await cache.get("fingerprint");
    expect(stored).toBeNull();
  });
});
