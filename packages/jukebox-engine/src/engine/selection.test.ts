import { describe, expect, it } from "vitest";
import { createRng } from "./random";
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

function linkBeats(beats: QuantumBase[]) {
  beats.forEach((beat, idx) => {
    beat.prev = idx > 0 ? beats[idx - 1] : null;
    beat.next = idx < beats.length - 1 ? beats[idx + 1] : null;
  });
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

  it("prefers a longer immediate jump when downstream reach ties", () => {
    const seed = makeBeat(10);
    const shortTarget = makeBeat(8);
    const longTarget = makeBeat(2);
    seed.neighbors.push(
      {
        id: 0,
        src: seed,
        dest: shortTarget,
        distance: 5,
        deleted: false,
      },
      {
        id: 1,
        src: seed,
        dest: longTarget,
        distance: 20,
        deleted: false,
      },
    );
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
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
      lastBranchPoint: 10,
      totalBeats: 20,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.99,
      { curRandomBranchChance: 0.18 },
    );
    expect(selection.index).toBe(2);
    expect(selection.jumped).toBe(true);
  });

  it("prefers a branch that can reach earlier beats after lookahead", () => {
    const beats = Array.from({ length: 12 }, (_, idx) => makeBeat(idx));
    linkBeats(beats);
    const seed = beats[10];
    const localTarget = beats[9];
    const deepTarget = beats[7];
    const earlyTarget = beats[1];

    seed.neighbors.push(
      {
        id: 0,
        src: seed,
        dest: localTarget,
        distance: 10,
        deleted: false,
      },
      {
        id: 1,
        src: seed,
        dest: deepTarget,
        distance: 20,
        deleted: false,
      },
    );
    // Only the deeper target can eventually branch much earlier.
    deepTarget.neighbors.push({
      id: 2,
      src: deepTarget,
      dest: earlyTarget,
      distance: 15,
      deleted: false,
    });

    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
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
      lastBranchPoint: 10,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.99,
      { curRandomBranchChance: 0.18 },
    );
    expect(selection.index).toBe(7);
    expect(selection.jumped).toBe(true);
  });

  it("prefers fewer additional branches to reach the early target zone", () => {
    const beats = Array.from({ length: 13 }, (_, idx) => makeBeat(idx));
    linkBeats(beats);
    const seed = beats[10];
    const fartherTarget = beats[8];
    const nearerTarget = beats[6];
    const earlyTarget = beats[2];

    seed.neighbors.push(
      {
        id: 0,
        src: seed,
        dest: fartherTarget,
        distance: 5,
        deleted: false,
      },
      {
        id: 1,
        src: seed,
        dest: nearerTarget,
        distance: 25,
        deleted: false,
      },
    );
    // From beat 8, reaching the early zone needs two additional branches (8 -> 6 -> 2).
    fartherTarget.neighbors.push({
      id: 2,
      src: fartherTarget,
      dest: nearerTarget,
      distance: 5,
      deleted: false,
    });
    // From beat 6, only one additional branch is needed (6 -> 2).
    nearerTarget.neighbors.push({
      id: 3,
      src: nearerTarget,
      dest: earlyTarget,
      distance: 10,
      deleted: false,
    });

    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
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
      lastBranchPoint: 10,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [],
    };
    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.99,
      { curRandomBranchChance: 0.18 },
    );
    expect(selection.index).toBe(6);
    expect(selection.jumped).toBe(true);
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

  it("de-prioritizes immediately repeating the same non-anchor destination", () => {
    const seed = makeBeat(4);
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
        distance: 10,
        deleted: false,
      },
    );
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 1,
      maxRandomBranchChance: 1,
      randomBranchChanceDelta: 0,
      minLongBranch: 1,
    };
    const graph: JukeboxGraphState = {
      computedThreshold: 60,
      currentThreshold: 60,
      lastBranchPoint: 99,
      totalBeats: 5,
      longestReach: 0,
      allEdges: [],
    };
    const rngValues = [0.49, 0.49];
    const rng = () => rngValues.shift() ?? 0.49;
    const state = { curRandomBranchChance: 1 };

    const first = selectNextBeatIndex(seed, graph, config, rng, state);
    const second = selectNextBeatIndex(seed, graph, config, rng, state);

    expect(first.index).toBe(1);
    expect(second.index).toBe(2);
  });

  it("produces the same branch path for the same seeded rng sequence", () => {
    function runPath() {
      const beats = Array.from({ length: 6 }, (_item, idx) => makeBeat(idx));
      linkBeats(beats);
      beats[1].neighbors.push(
        { id: 1, src: beats[1], dest: beats[4], distance: 4, deleted: false },
        { id: 2, src: beats[1], dest: beats[0], distance: 7, deleted: false },
      );
      beats[2].neighbors.push(
        { id: 3, src: beats[2], dest: beats[5], distance: 3, deleted: false },
        { id: 4, src: beats[2], dest: beats[0], distance: 12, deleted: false },
      );
      beats[3].neighbors.push(
        { id: 5, src: beats[3], dest: beats[0], distance: 2, deleted: false },
        { id: 6, src: beats[3], dest: beats[1], distance: 9, deleted: false },
      );
      const config: JukeboxConfig = {
        maxBranches: 4,
        maxBranchThreshold: 80,
        currentThreshold: 60,
        justBackwards: false,
        justLongBranches: false,
        removeSequentialBranches: false,
        minRandomBranchChance: 1,
        maxRandomBranchChance: 1,
        randomBranchChanceDelta: 0,
        minLongBranch: 1,
      };
      const graph: JukeboxGraphState = {
        computedThreshold: 60,
        currentThreshold: 60,
        lastBranchPoint: 99,
        totalBeats: beats.length,
        longestReach: 0,
        allEdges: [],
      };
      const rng = createRng("seeded", 1337);
      const state = { curRandomBranchChance: 1 };
      return [beats[1], beats[2], beats[3]].map((beat) =>
        selectNextBeatIndex(beat, graph, config, rng, state),
      );
    }

    expect(runPath()).toEqual(runPath());
  });

  it("suppresses the default anchor branch before a selected user anchor", () => {
    const beats = Array.from({ length: 6 }, (_item, idx) => makeBeat(idx));
    linkBeats(beats);
    const seed = beats[1];
    const userAnchorSource = beats[4];
    const earlyEdge = {
      id: 1,
      src: seed,
      dest: beats[0],
      distance: 1,
      deleted: false,
    };
    const userAnchorEdge = {
      id: 9,
      src: userAnchorSource,
      dest: beats[0],
      distance: 1,
      deleted: false,
    };
    seed.neighbors.push(earlyEdge);
    userAnchorSource.neighbors.push(userAnchorEdge);
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0,
      minLongBranch: 1,
    };
    const graph: JukeboxGraphState = {
      computedThreshold: 60,
      currentThreshold: 60,
      lastBranchPoint: seed.which,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [earlyEdge, userAnchorEdge],
    };

    const selection = selectNextBeatIndex(
      seed,
      graph,
      config,
      () => 0.99,
      { curRandomBranchChance: 0.18 },
      false,
      { edgeId: userAnchorEdge.id, sourceIndex: userAnchorSource.which },
    );

    expect(selection).toEqual({ index: seed.which, jumped: false });
  });
});

describe("shouldRandomBranch", () => {
  const config: JukeboxConfig = {
    maxBranches: 4,
    maxBranchThreshold: 80,
    currentThreshold: 60,
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

  it("ramps slower for short beats and faster for long beats", () => {
    const shortBeat = makeBeat(0);
    shortBeat.duration = 0.25;
    const longBeat = makeBeat(1);
    longBeat.duration = 1;
    const shortState = { curRandomBranchChance: 0.1 };
    const longState = { curRandomBranchChance: 0.1 };

    shouldRandomBranch(shortBeat, graph, config, () => 0.99, shortState);
    shouldRandomBranch(longBeat, graph, config, () => 0.99, longState);

    expect(shortState.curRandomBranchChance).toBeCloseTo(0.125, 6);
    expect(longState.curRandomBranchChance).toBeCloseTo(0.2, 6);
  });

  it("uses reference beat duration for non-positive or non-finite durations", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const beat = makeBeat(0);
      beat.duration = duration;
      const state = { curRandomBranchChance: 0.1 };

      shouldRandomBranch(beat, graph, config, () => 0.99, state);

      expect(state.curRandomBranchChance).toBeCloseTo(0.15, 6);
    }
  });
});
