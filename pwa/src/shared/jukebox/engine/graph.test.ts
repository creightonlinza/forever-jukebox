import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import type { JukeboxConfig } from "./types";

function createVector(seed: number): number[] {
  const values = new Array<number>(12).fill(0);
  values[seed % 12] = 1;
  values[(seed + 5) % 12] = 0.35;
  return values;
}

function createAnalysis(totalBeats: number, beatDuration: number) {
  const duration = totalBeats * beatDuration;
  return {
    sections: [{ start: 0, duration, confidence: 1 }],
    bars: Array.from({ length: Math.ceil(totalBeats / 4) }, (_, idx) => ({
      start: idx * beatDuration * 4,
      duration: Math.min(beatDuration * 4, duration - idx * beatDuration * 4),
      confidence: 1,
    })),
    beats: Array.from({ length: totalBeats }, (_, idx) => ({
      start: idx * beatDuration,
      duration: beatDuration,
      confidence: 1,
    })),
    tatums: Array.from({ length: totalBeats * 2 }, (_, idx) => ({
      start: idx * (beatDuration / 2),
      duration: beatDuration / 2,
      confidence: 1,
    })),
    segments: Array.from({ length: totalBeats }, (_, idx) => ({
      start: idx * beatDuration,
      duration: beatDuration,
      confidence: 1,
      loudness_start: -8 + (idx % 3),
      loudness_max: -3 + (idx % 2),
      loudness_max_time: beatDuration / 2,
      pitches: createVector(idx),
      timbre: createVector(idx + 3),
    })),
    track: {
      duration,
      tempo: 120,
      time_signature: 4,
    },
  };
}

describe("PWA jump graph defaults", () => {
  it("uses an even auto-computed threshold when currentThreshold is 0", () => {
    const analysis = normalizeAnalysis(createAnalysis(40, 0.5));
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 0,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.02,
      minLongBranch: 1,
    };
    const graph = buildJumpGraph(analysis, config);
    expect(graph.currentThreshold).toBe(graph.computedThreshold);
    expect(graph.currentThreshold).toBeGreaterThan(0);
    expect(graph.currentThreshold % 2).toBe(0);
  });
});
