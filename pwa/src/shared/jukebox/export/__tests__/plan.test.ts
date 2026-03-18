import { describe, expect, it } from "vitest";
import type { AnalysisOutput } from "@/shared/analysis-schema";
import type { JukeboxConfig } from "@/shared/jukebox/engine";
import { planJukeboxPath } from "../plan";

function createVector(seed: number): number[] {
  const values = new Array<number>(12).fill(0);
  values[seed % 12] = 1;
  values[(seed + 5) % 12] = 0.35;
  return values;
}

function createAnalysis(totalBeats: number, beatDuration: number): AnalysisOutput {
  const duration = totalBeats * beatDuration;
  return {
    engine_version: 2,
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

const baseConfig: JukeboxConfig = {
  maxBranches: 4,
  maxBranchThreshold: 120,
  currentThreshold: 120,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  minRandomBranchChance: 0.18,
  maxRandomBranchChance: 0.5,
  randomBranchChanceDelta: 0.02,
  minLongBranch: 0,
};

describe("planJukeboxPath", () => {
  it("is deterministic with seeded random mode", () => {
    const analysis = createAnalysis(40, 0.5);

    const first = planJukeboxPath({
      analysis,
      bufferDurationSeconds: 20,
      durationSeconds: 12,
      config: baseConfig,
      randomMode: "seeded",
      seed: 4242,
    });
    const second = planJukeboxPath({
      analysis,
      bufferDurationSeconds: 20,
      durationSeconds: 12,
      config: baseConfig,
      randomMode: "seeded",
      seed: 4242,
    });

    expect(first.segments.map((segment) => segment.beatIndex)).toEqual(
      second.segments.map((segment) => segment.beatIndex),
    );
  });

  it("covers requested duration without overshooting", () => {
    const analysis = createAnalysis(40, 0.5);

    const planned = planJukeboxPath({
      analysis,
      bufferDurationSeconds: 20,
      durationSeconds: 7.3,
      config: baseConfig,
      randomMode: "seeded",
      seed: 100,
    });

    expect(planned.renderDurationSeconds).toBeGreaterThan(7.0);
    expect(planned.renderDurationSeconds).toBeLessThanOrEqual(7.3);
  });

  it("applies deleted edges to the exported jump path", () => {
    const analysis = createAnalysis(48, 0.5);
    const alwaysBranchConfig: JukeboxConfig = {
      ...baseConfig,
      minRandomBranchChance: 1,
      maxRandomBranchChance: 1,
      randomBranchChanceDelta: 0,
    };

    const baseline = planJukeboxPath({
      analysis,
      bufferDurationSeconds: 24,
      durationSeconds: 10,
      config: alwaysBranchConfig,
      randomMode: "seeded",
      seed: 5,
    });

    const deleted = baseline.segments.find(
      (segment) => segment.jumped && segment.jumpFromIndex !== null,
    );
    expect(deleted).toBeDefined();
    if (!deleted || deleted.jumpFromIndex === null) {
      return;
    }

    const withDeletion = planJukeboxPath({
      analysis,
      bufferDurationSeconds: 24,
      durationSeconds: 10,
      config: alwaysBranchConfig,
      randomMode: "seeded",
      seed: 5,
      deletedEdges: [
        {
          src: deleted.jumpFromIndex,
          dest: deleted.beatIndex,
        },
      ],
    });

    const removedPair = `${deleted.jumpFromIndex}-${deleted.beatIndex}`;
    const plannedPairs = withDeletion.segments
      .filter((segment) => segment.jumped && segment.jumpFromIndex !== null)
      .map((segment) => `${segment.jumpFromIndex}-${segment.beatIndex}`);

    expect(plannedPairs).not.toContain(removedPair);
  });
});
