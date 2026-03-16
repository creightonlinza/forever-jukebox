import { describe, expect, it } from "vitest";
import { selectNextBeatIndex, shouldRandomBranch } from "./selection";
import type { JukeboxConfig, JukeboxGraphState, QuantumBase } from "./types";
import { JukeboxEngine } from "./JukeboxEngine";

function makeBeat(which: number): QuantumBase {
  return {
    start: which,
    duration: 1,
    confidence: 1,
    which,
    prev: null,
    next: null,
    overlappingSegments: [],
    neighbors: [],
    allNeighbors: [],
  };
}

const graph: JukeboxGraphState = {
  computedThreshold: 60,
  currentThreshold: 60,
  lastBranchPoint: 99,
  totalBeats: 2,
  longestReach: 0,
  allEdges: [],
};

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

describe("PWA branch ramp parity", () => {
  it("uses the same 0.02 default random branch ramp as web", () => {
    const engine = new JukeboxEngine({
      play() {},
      pause() {},
      stop() {},
      seek(_time: number) {},
      scheduleJump(_targetTime: number, _audioStart: number) {},
      getCurrentTime() {
        return 0;
      },
      getAudioTime() {
        return 0;
      },
      isPlaying() {
        return false;
      },
    });
    expect(engine.getConfig().randomBranchChanceDelta).toBe(0.02);
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
    const alwaysBranchConfig: JukeboxConfig = {
      ...config,
      minRandomBranchChance: 1,
      maxRandomBranchChance: 1,
      randomBranchChanceDelta: 0,
    };
    const rngValues = [0.49, 0.49];
    const rng = () => rngValues.shift() ?? 0.49;
    const state = { curRandomBranchChance: 1 };

    const first = selectNextBeatIndex(seed, graph, alwaysBranchConfig, rng, state);
    const second = selectNextBeatIndex(seed, graph, alwaysBranchConfig, rng, state);

    expect(first.index).toBe(1);
    expect(second.index).toBe(2);
  });
});
