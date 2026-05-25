import { describe, expect, it } from "vitest";
import { selectNextBeatIndex, shouldRandomBranch } from "./selection";
import type {
  Edge,
  JukeboxConfig,
  JukeboxGraphState,
  QuantumBase,
  TrackAnalysis,
} from "./types";
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

function linkBeats(beats: QuantumBase[]) {
  for (let i = 0; i < beats.length; i += 1) {
    beats[i].prev = i > 0 ? beats[i - 1] : null;
    beats[i].next = i < beats.length - 1 ? beats[i + 1] : null;
  }
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
      scheduleJump(_targetTime: number, _audioStart: number) {
        return true;
      },
      cancelScheduledJump() {},
      getCurrentTime() {
        return 0;
      },
      getAudioTime() {
        return 0;
      },
      getPlaybackRate() {
        return 1;
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

  it("promotes a fallback anchor source when the current anchor edge is deleted", () => {
    const engine = new JukeboxEngine({
      play() {},
      pause() {},
      stop() {},
      seek(_time: number) {},
      scheduleJump(_targetTime: number, _audioStart: number) {
        return true;
      },
      cancelScheduledJump() {},
      getCurrentTime() {
        return 0;
      },
      getAudioTime() {
        return 0;
      },
      getPlaybackRate() {
        return 1;
      },
      isPlaying() {
        return false;
      },
    });
    const beats = [makeBeat(0), makeBeat(1), makeBeat(2)];
    linkBeats(beats);
    const anchorEdge: Edge = {
      id: 0,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    const fallbackEdge: Edge = {
      id: 1,
      src: beats[2],
      dest: beats[0],
      distance: 9,
      deleted: false,
    };
    beats[1].neighbors = [anchorEdge];
    beats[1].allNeighbors = [anchorEdge];
    beats[2].neighbors = [fallbackEdge];
    beats[2].allNeighbors = [fallbackEdge];
    const graphState: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [anchorEdge, fallbackEdge],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
    };
    engineAny.analysis = {
      sections: [],
      bars: [],
      beats,
      tatums: [],
      segments: [],
      track: { duration: beats.length },
    };
    engineAny.graph = graphState;
    engineAny.beats = beats;

    engine.deleteEdge(anchorEdge);

    expect(engine.getGraphState()?.lastBranchPoint).toBe(2);
    expect(engine.getVisualizationData()?.anchorEdgeId).toBe(1);
  });
});
