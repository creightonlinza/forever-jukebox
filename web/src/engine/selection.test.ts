import { describe, expect, it } from "vitest";
import { selectNextBeatIndex, shouldRandomBranch } from "./selection";
import { JukeboxConfig, JukeboxGraphState, QuantumBase } from "./types";

function makeBeat(which: number): QuantumBase {
  return {
    start: which,
    duration: 1,
    which,
    prev: null,
    next: null,
    overlappingSegments: [],
    neighbors: [],
    allNeighbors: [],
  };
}

describe("selectNextBeatIndex", () => {
  it("forces a branch at the last branch point", () => {
    const seed = makeBeat(1);
    const target = makeBeat(0);
    seed.neighbors.push({
      id: 0,
      src: seed,
      dest: target,
      distance: 10,
      deleted: false,
    });
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      addLastEdge: true,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph: JukeboxGraphState = {
      computedThreshold: 60,
      currentThreshold: 60,
      lastBranchPoint: 1,
      totalBeats: 2,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.99,
      { curRandomBranchChance: 0.18 }
    );
    expect(selection.index).toBe(0);
    expect(selection.jumped).toBe(true);
  });

  it("branches when random chance triggers", () => {
    const seed = makeBeat(1);
    const target = makeBeat(2);
    seed.neighbors.push({
      id: 0,
      src: seed,
      dest: target,
      distance: 10,
      deleted: false,
    });
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      addLastEdge: true,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph: JukeboxGraphState = {
      computedThreshold: 60,
      currentThreshold: 60,
      lastBranchPoint: 99,
      totalBeats: 2,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.1,
      { curRandomBranchChance: 0.18 }
    );
    expect(selection.index).toBe(2);
    expect(selection.jumped).toBe(true);
  });

  it("rotates neighbor order after a jump", () => {
    const seed = makeBeat(0);
    const firstTarget = makeBeat(1);
    const secondTarget = makeBeat(2);
    seed.neighbors.push(
      {
        id: 0,
        src: seed,
        dest: firstTarget,
        distance: 10,
        deleted: false,
      },
      {
        id: 1,
        src: seed,
        dest: secondTarget,
        distance: 12,
        deleted: false,
      }
    );
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      addLastEdge: true,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph: JukeboxGraphState = {
      computedThreshold: 60,
      currentThreshold: 60,
      lastBranchPoint: 0,
      totalBeats: 3,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.01,
      { curRandomBranchChance: 0.18 }
    );
    expect(selection.index).toBe(1);
    expect(seed.neighbors[0].dest.which).toBe(2);
    expect(seed.neighbors[1].dest.which).toBe(1);
  });

  it("keeps index when random chance does not trigger", () => {
    const seed = makeBeat(0);
    const target = makeBeat(3);
    seed.neighbors.push({
      id: 0,
      src: seed,
      dest: target,
      distance: 10,
      deleted: false,
    });
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      addLastEdge: true,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph: JukeboxGraphState = {
      computedThreshold: 60,
      currentThreshold: 60,
      lastBranchPoint: 99,
      totalBeats: 4,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.9,
      { curRandomBranchChance: 0.18 }
    );
    expect(selection.index).toBe(0);
    expect(selection.jumped).toBe(false);
  });
});

describe("shouldRandomBranch", () => {
  const config: JukeboxConfig = {
    maxBranches: 4,
    maxBranchThreshold: 80,
    currentThreshold: 60,
    addLastEdge: true,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
    minRandomBranchChance: 0.1,
    maxRandomBranchChance: 0.3,
    randomBranchChanceDelta: 0.05,
    minLongBranch: 1,
  };
  const graph: JukeboxGraphState = {
    computedThreshold: 60,
    currentThreshold: 60,
    lastBranchPoint: 99,
    totalBeats: 2,
    longestReach: 0,
    allEdges: [],
  };

  it("ramps branch chance and clamps to max", () => {
    const beat = makeBeat(0);
    const state = { curRandomBranchChance: 0.28 };
    const shouldBranch = shouldRandomBranch(beat, graph, config, () => 0.99, state);
    expect(shouldBranch).toBe(false);
    expect(state.curRandomBranchChance).toBe(0.3);
  });

  it("resets branch chance to min when branching", () => {
    const beat = makeBeat(0);
    const state = { curRandomBranchChance: 0.25 };
    const shouldBranch = shouldRandomBranch(beat, graph, config, () => 0.0, state);
    expect(shouldBranch).toBe(true);
    expect(state.curRandomBranchChance).toBe(0.1);
  });
});
