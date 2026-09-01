import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import { createRng } from "./random";
import {
  selectNextBeatIndex,
  type BranchState,
  type UserAnchorSelection,
} from "./selection";
import type { JukeboxConfig, TrackAnalysis } from "./types";

// A full engine analysis of a CC0 track, replayed through the graph builder and
// the branch selector so that a change in threshold defaults, edge selection,
// anchor placement, or the seeded jump sequence has to be an explicit fixture
// update. The web e2e suite serves the same embedded analysis to the app, so
// its branch counts and this contract stay tied.
type CaseConfig = {
  currentThreshold: number;
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
  maxBranches: number;
  maxBranchThreshold: number;
  minLongBranch: number;
};

type GraphExpectation = {
  computedThreshold: number;
  currentThreshold: number;
  lastBranchPoint: number;
  totalBeats: number;
  longestReach: number;
  allEdgesCount: number;
  activeEdgeCount: number;
  branchingBeatCount: number;
};

type FixtureCase = { id: string; config: CaseConfig; expected: GraphExpectation };

type DeletionCase = {
  id: string;
  config: CaseConfig;
  deleteEdgeIds: number[];
  expected: {
    activeEdgeCountBefore: number;
    activeEdgeCountAfter: number;
    deletedEdgeCount: number;
  };
};

type SequenceCase = {
  id: string;
  seed: number;
  steps: number;
  userAnchorEdgeId: number | null;
  config: {
    currentThreshold: number;
    minRandomBranchChance: number;
    maxRandomBranchChance: number;
    randomBranchChanceDelta: number;
    maxBranches: number;
    maxBranchThreshold: number;
    minLongBranch: number;
  };
  expected: {
    jumpCount: number;
    jumps: Array<[number, number, number]>;
    beatSequence: number[];
  };
};

type FixtureDoc = {
  schema_version: number;
  source: { title: string; artist: string; license: string; engine_version: number };
  analysis: unknown;
  cases: FixtureCase[];
  deletion_cases: DeletionCase[];
  sequence_cases: SequenceCase[];
};

function loadFixture(): FixtureDoc {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    currentDir,
    "../../../../test-fixtures/engine-parity/real-analysis-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

function graphConfig(caseConfig: CaseConfig): JukeboxConfig {
  return {
    maxBranches: caseConfig.maxBranches,
    maxBranchThreshold: caseConfig.maxBranchThreshold,
    currentThreshold: caseConfig.currentThreshold,
    justBackwards: caseConfig.justBackwards,
    justLongBranches: caseConfig.justLongBranches,
    removeSequentialBranches: caseConfig.removeSequentialBranches,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.02,
    minLongBranch: caseConfig.minLongBranch,
  };
}

function sequenceConfig(caseConfig: SequenceCase["config"]): JukeboxConfig {
  return {
    maxBranches: caseConfig.maxBranches,
    maxBranchThreshold: caseConfig.maxBranchThreshold,
    currentThreshold: caseConfig.currentThreshold,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
    minRandomBranchChance: caseConfig.minRandomBranchChance,
    maxRandomBranchChance: caseConfig.maxRandomBranchChance,
    randomBranchChanceDelta: caseConfig.randomBranchChanceDelta,
    minLongBranch: caseConfig.minLongBranch,
  };
}

function countActiveEdges(analysis: TrackAnalysis) {
  let activeEdgeCount = 0;
  let branchingBeatCount = 0;
  for (const beat of analysis.beats) {
    const active = beat.neighbors.filter((edge) => !edge.deleted);
    activeEdgeCount += active.length;
    if (active.length > 0) {
      branchingBeatCount += 1;
    }
  }
  return { activeEdgeCount, branchingBeatCount };
}

// Mirrors JukeboxEngine.createPendingAdvance for ordinary playback: the next
// selection is seeded one beat ahead (wrapping at the end), and a jump replaces
// that seed with its destination. Timing-dependent paths (schedule lead, bring
// it home, velocity) are outside this contract.
function replaySequence(testCase: SequenceCase) {
  const fixture = loadFixture();
  const analysis = normalizeAnalysis(fixture.analysis);
  const config = sequenceConfig(testCase.config);
  const graph = buildJumpGraph(analysis, config);
  const rng = createRng("seeded", testCase.seed);
  const state: BranchState = {
    curRandomBranchChance: config.minRandomBranchChance,
  };
  let userAnchor: UserAnchorSelection | null = null;
  if (testCase.userAnchorEdgeId !== null) {
    const edge = graph.allEdges.find(
      (candidate) => candidate.id === testCase.userAnchorEdgeId,
    );
    expect(edge, `${testCase.id}: anchor edge must exist`).toBeTruthy();
    userAnchor = { edgeId: edge!.id, sourceIndex: edge!.src.which };
  }

  const beats = analysis.beats;
  const beatSequence: number[] = [];
  const jumps: Array<[number, number, number]> = [];
  let current = 0;
  for (let step = 0; step < testCase.steps; step += 1) {
    const seedIndex = (((current + 1) % beats.length) + beats.length) % beats.length;
    const selection = selectNextBeatIndex(
      beats[seedIndex],
      graph,
      config,
      rng,
      state,
      false,
      userAnchor,
    );
    if (selection.jumped) {
      jumps.push([step, seedIndex, selection.index]);
      current = selection.index;
    } else {
      current = seedIndex;
    }
    beatSequence.push(current);
  }
  return { beatSequence, jumps };
}

describe("real-analysis parity fixtures", () => {
  const fixture = loadFixture();

  it("matches the pinned graph signature for every tuning case", () => {
    for (const testCase of fixture.cases) {
      const analysis = normalizeAnalysis(fixture.analysis);
      const graph = buildJumpGraph(analysis, graphConfig(testCase.config));
      const { activeEdgeCount, branchingBeatCount } = countActiveEdges(analysis);

      expect(
        {
          computedThreshold: graph.computedThreshold,
          currentThreshold: graph.currentThreshold,
          lastBranchPoint: graph.lastBranchPoint,
          totalBeats: graph.totalBeats,
          longestReach: Math.round(graph.longestReach * 1_000_000) / 1_000_000,
          allEdgesCount: graph.allEdges.length,
          activeEdgeCount,
          branchingBeatCount,
        },
        testCase.id,
      ).toEqual(testCase.expected);
    }
  });

  it("keeps branch counts monotonic across the threshold sweep", () => {
    const sweep = fixture.cases
      .filter((testCase) => /^threshold_\d+$/.test(testCase.id))
      .sort((a, b) => a.config.currentThreshold - b.config.currentThreshold);
    expect(sweep.length).toBeGreaterThan(1);
    for (let i = 1; i < sweep.length; i += 1) {
      expect(
        sweep[i].expected.activeEdgeCount,
        `${sweep[i].id} vs ${sweep[i - 1].id}`,
      ).toBeGreaterThan(sweep[i - 1].expected.activeEdgeCount);
    }
  });

  // Deleting by id is how the d= URL param reaches the engine; the ids are only
  // stable while edge construction order is, so they are pinned too.
  it("drops exactly the deleted edges from the active set", () => {
    for (const testCase of fixture.deletion_cases) {
      const analysis = normalizeAnalysis(fixture.analysis);
      buildJumpGraph(analysis, graphConfig(testCase.config));
      expect(
        countActiveEdges(analysis).activeEdgeCount,
        `${testCase.id}: before deletion`,
      ).toBe(testCase.expected.activeEdgeCountBefore);

      const deletedIds = new Set(testCase.deleteEdgeIds);
      for (const beat of analysis.beats) {
        for (const edge of beat.allNeighbors) {
          if (deletedIds.has(edge.id)) {
            edge.deleted = true;
          }
        }
        beat.neighbors = beat.neighbors.filter((edge) => !edge.deleted);
      }

      expect(
        countActiveEdges(analysis).activeEdgeCount,
        `${testCase.id}: after deletion`,
      ).toBe(testCase.expected.activeEdgeCountAfter);
      expect(
        testCase.expected.activeEdgeCountBefore -
          testCase.expected.activeEdgeCountAfter,
        `${testCase.id}: every pinned id was active`,
      ).toBe(testCase.expected.deletedEdgeCount);
    }
  });

  it("reproduces the seeded playback sequence", () => {
    for (const testCase of fixture.sequence_cases) {
      const { beatSequence, jumps } = replaySequence(testCase);
      expect(jumps.length, `${testCase.id}: jump count`).toBe(
        testCase.expected.jumpCount,
      );
      expect(jumps, `${testCase.id}: jumps`).toEqual(testCase.expected.jumps);
      expect(beatSequence, `${testCase.id}: beat sequence`).toEqual(
        testCase.expected.beatSequence,
      );
    }
  });

  it("keeps the jump rate ordered by the configured branch chance", () => {
    const byId = new Map(fixture.sequence_cases.map((c) => [c.id, c]));
    const low = byId.get("seeded_low_branch_chance");
    const mid = byId.get("seeded_default_branch_chance");
    const high = byId.get("seeded_high_branch_chance");
    expect(low && mid && high).toBeTruthy();
    expect(low!.expected.jumpCount).toBeLessThan(mid!.expected.jumpCount);
    expect(mid!.expected.jumpCount).toBeLessThan(high!.expected.jumpCount);
  });
});
