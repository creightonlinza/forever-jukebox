import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import type { JukeboxConfig, TrackAnalysis } from "./types";
import {
  emptySegmentsAnalysis,
  happyPathAnalysis,
  longBranchDensityAnalysis,
  oddTimingAnalysis,
  sparseLowBranchAnalysis,
  tinyBranchAnalysis,
} from "./__fixtures__/analysisFixtures";

function config(overrides: Partial<JukeboxConfig> = {}): JukeboxConfig {
  return {
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
    ...overrides,
  };
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function graphSignature(analysis: TrackAnalysis, overrides: Partial<JukeboxConfig> = {}) {
  const graph = buildJumpGraph(analysis, config(overrides));
  return {
    graph: {
      computedThreshold: graph.computedThreshold,
      currentThreshold: graph.currentThreshold,
      lastBranchPoint: graph.lastBranchPoint,
      totalBeats: graph.totalBeats,
      longestReach: rounded(graph.longestReach),
      allEdgesCount: graph.allEdges.length,
    },
    activeEdges: analysis.beats
      .flatMap((beat) =>
        beat.neighbors.map((edge) => [
          edge.src.which,
          edge.dest.which,
          rounded(edge.distance),
        ]),
      )
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
    allEdges: graph.allEdges.map((edge) => [
      edge.id,
      edge.src.which,
      edge.dest.which,
      rounded(edge.distance),
    ]),
  };
}

describe("parsed analysis graph integration", () => {
  it("builds a stable graph signature from parsed happy-path analysis", () => {
    const signature = graphSignature(normalizeAnalysis(happyPathAnalysis()));

    expect(signature.graph).toEqual({
      computedThreshold: 10,
      currentThreshold: 10,
      lastBranchPoint: 11,
      totalBeats: 12,
      longestReach: 91.666667,
      allEdgesCount: 24,
    });
    expect(signature.activeEdges).toEqual([
      [0, 4, 0],
      [0, 8, 0],
      [1, 5, 0],
      [1, 9, 0],
      [2, 6, 0],
      [2, 10, 0],
      [3, 7, 0],
      [4, 0, 0],
      [4, 8, 0],
      [5, 1, 0],
      [5, 9, 0],
      [6, 2, 0],
      [6, 10, 0],
      [7, 3, 0],
      [8, 0, 0],
      [8, 4, 0],
      [9, 1, 0],
      [9, 5, 0],
      [10, 2, 0],
      [10, 6, 0],
      [11, 3, 0],
      [11, 7, 0],
    ]);
  });

  it("generates deterministic branch structures for the same parsed input", () => {
    const first = graphSignature(normalizeAnalysis(tinyBranchAnalysis()));
    const second = graphSignature(normalizeAnalysis(tinyBranchAnalysis()));

    expect(second).toEqual(first);
    expect(first.graph).toEqual({
      computedThreshold: 10,
      currentThreshold: 10,
      lastBranchPoint: 7,
      totalBeats: 8,
      longestReach: 87.5,
      allEdgesCount: 8,
    });
  });

  it("handles empty and sparse segment data without invalid edge indexes", () => {
    for (const makeFixture of [emptySegmentsAnalysis, sparseLowBranchAnalysis]) {
      const analysis = normalizeAnalysis(makeFixture());
      const signature = graphSignature(analysis);

      expect(signature.graph.lastBranchPoint).toBe(-1);
      expect(signature.graph.allEdgesCount).toBe(0);
      expect(signature.activeEdges).toEqual([]);
      expect(
        signature.allEdges.every(
          (edge) =>
            edge[1] >= 0 &&
            edge[1] < analysis.beats.length &&
            edge[2] >= 0 &&
            edge[2] < analysis.beats.length,
        ),
      ).toBe(true);
    }
  });

  it("preserves odd timing behavior without producing out-of-range graph edges", () => {
    const analysis = normalizeAnalysis(oddTimingAnalysis());
    const signature = graphSignature(analysis);

    expect(signature.graph).toEqual({
      computedThreshold: 80,
      currentThreshold: 80,
      lastBranchPoint: -1,
      totalBeats: 4,
      longestReach: 0,
      allEdgesCount: 0,
    });
    expect(analysis.beats.map((beat) => beat.start)).toEqual([0, 1, 1, 0.75]);
  });

  it("locks branch density for a longer generated analysis", () => {
    const signature = graphSignature(normalizeAnalysis(longBranchDensityAnalysis(96)));

    expect(signature.graph).toEqual({
      computedThreshold: 10,
      currentThreshold: 10,
      lastBranchPoint: 95,
      totalBeats: 96,
      longestReach: 98.958333,
      allEdgesCount: 384,
    });
    expect(signature.activeEdges).toHaveLength(384);
    expect(signature.allEdges.slice(0, 8)).toEqual([
      [0, 0, 16, 0],
      [1, 0, 32, 0],
      [2, 0, 48, 0],
      [3, 0, 64, 0],
      [4, 1, 17, 0],
      [5, 1, 33, 0],
      [6, 1, 49, 0],
      [7, 1, 65, 0],
    ]);
  });
});
