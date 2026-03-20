import { describe, expect, it } from "vitest";
import { formatExportJson } from "../exportJson";

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

describe("export JSON", () => {
  it("pretty prints and includes metadata", () => {
    const json = formatExportJson(analysis, {
      createdAt: "2026-02-11T00:00:00.000Z",
      appVersion: "0.1.0",
      fingerprint: "abc",
    });
    const parsed = JSON.parse(json);
    expect(parsed.metadata.fingerprint).toBe("abc");
    expect(parsed.engine_version).toBe(1);
    expect(parsed.engine_origin).toBe("forever-jukebox-pwa");
    expect(json.includes("\n  \"metadata\"")).toBe(true);
  });
});
