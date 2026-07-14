import { describe, expect, it } from "vitest";
import type {
  Edge,
  JukeboxGraphState,
  QuantumBase,
  TrackAnalysis,
} from "./types";
import { JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";

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

function makePlayer(): JukeboxPlayer {
  return {
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
  };
}

describe("JukeboxEngine config defaults", () => {
  it("defaults the random branch ramp delta to 0.02", () => {
    const engine = new JukeboxEngine(makePlayer());
    expect(engine.getConfig().randomBranchChanceDelta).toBe(0.02);
  });
});

describe("JukeboxEngine anchor fallback", () => {
  it("promotes a fallback anchor source when the current anchor edge is deleted", () => {
    const engine = new JukeboxEngine(makePlayer());
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
