import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/backgroundTimer", () => ({
  backgroundSetTimeout: (
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => globalThis.setTimeout(callback, delay, ...args),
  backgroundClearTimeout: (id: number) => globalThis.clearTimeout(id),
}));
import { JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";
import type {
  Edge,
  JukeboxGraphState,
  QuantumBase,
  TrackAnalysis,
} from "./types";

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

function makeAnalysis(beats: QuantumBase[]): TrackAnalysis {
  return {
    sections: [],
    bars: [],
    beats,
    tatums: [],
    segments: [],
    track: {},
  };
}

function makeSegment(idx: number) {
  return {
    start: idx,
    duration: 1,
    confidence: 1,
    loudness_start: 0,
    loudness_max: 0,
    loudness_max_time: 0,
    pitches: Array(12).fill(0),
    timbre: Array(12).fill(0),
  };
}

function makeAnalysisPayload(count: number) {
  const beats = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
  }));
  const segments = Array.from({ length: count }, (_, i) => makeSegment(i));
  return {
    sections: beats,
    bars: beats,
    beats,
    tatums: beats,
    segments,
    track: { duration: count },
  };
}

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(),
    cancelScheduledJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => true,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("JukeboxEngine branching", () => {
  it("derives section-start beat indices from normalized analysis", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    const beats = Array.from({ length: 8 }, (_, i) => ({
      start: i,
      duration: 1,
      confidence: 1,
    }));
    const segments = Array.from({ length: 8 }, (_, i) => makeSegment(i));
    engine.loadAnalysis({
      sections: [
        { start: 0, duration: 2.1, confidence: 1 },
        { start: 2.1, duration: 2.9, confidence: 1 },
        { start: 5, duration: 3, confidence: 1 },
      ],
      bars: beats,
      beats,
      tatums: beats,
      segments,
      track: { duration: 8 },
    });

    expect(engine.getSectionStartBeatIndices()).toEqual([3, 5]);
  });

  it("does not force a branch when only the current beat is the last branch point", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 1 });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[1].neighbors = [edge];
    beats[1].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(2);
    expect(player.scheduleJump).toHaveBeenCalledTimes(0);
    expect(engineAny.lastJumpFromIndex).toBe(null);
  });

  it("forces a branch when the next beat is the last branch point", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 1 });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[1].neighbors = [edge];
    beats[1].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 0;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 1);
    expect(engineAny.lastJumpFromIndex).toBe(1);
  });

  it("schedules a jump when wrapping past the last beat", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 2 });
    const beats = [0, 1].map(makeBeat);
    linkBeats(beats);
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 0,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 2);
    expect(engineAny.lastJumpFromIndex).toBe(1);
  });

  it("skips a branch when the source boundary is too close to schedule", () => {
    const player = {
      ...makePlayer(),
      getCurrentTime: () => 0.95,
    };
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 1 });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[1].neighbors = [edge];
    beats[1].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 0;
    engineAny.nextAudioTime = 10.05;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(1);
    expect(player.scheduleJump).not.toHaveBeenCalled();
    expect(engineAny.lastJumpFromIndex).toBe(null);
  });

  it("resetStats clears per-source branch repeat history", () => {
    const engine = new JukeboxEngine(makePlayer());
    const engineAny = engine as unknown as {
      branchState: { lastDestBySource: Map<number, number> | null };
    };
    engineAny.branchState.lastDestBySource = new Map([[4, 1]]);

    engine.resetStats();

    expect(engineAny.branchState.lastDestBySource).toBeNull();
  });
});

describe("JukeboxEngine playback loop", () => {
  beforeEach(() => {
    if (!("window" in globalThis)) {
      vi.stubGlobal("window", {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      });
    }
  });

  it("throws if startJukebox is called without analysis", () => {
    const engine = new JukeboxEngine(makePlayer());
    expect(() => engine.startJukebox()).toThrow("Analysis not loaded");
  });

  it("play/pause/stop delegate to the player", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    engine.play();
    engine.pause();
    engine.stopJukebox();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.stop).toHaveBeenCalledTimes(1);
  });

  it("updateConfig merges config changes", () => {
    const engine = new JukeboxEngine(makePlayer());
    const before = engine.getConfig().maxBranches;
    engine.updateConfig({ maxBranches: before + 1 });
    expect(engine.getConfig().maxBranches).toBe(before + 1);
  });

  it("uses legacy default random branch ramp", () => {
    const engine = new JukeboxEngine(makePlayer());
    expect(engine.getConfig().randomBranchChanceDelta).toBe(0.02);
  });

  it("ticks and advances beats based on audio time", () => {
    vi.useFakeTimers();
    if ("window" in globalThis) {
      const win = globalThis.window as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
      win.setTimeout = globalThis.setTimeout;
      win.clearTimeout = globalThis.clearTimeout;
    }
    let audioNow = 0;
    const player = makePlayer();
    player.getAudioTime = () => audioNow;
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    engine.loadAnalysis(makeAnalysisPayload(3));
    (engine as unknown as { graph?: { lastBranchPoint: number } }).graph!.lastBranchPoint =
      -1;
    engine.startJukebox();

    audioNow = 0.2;
    const engineAny = engine as unknown as {
      currentBeatIndex: number;
      tick: () => void;
    };
    engineAny.tick();
    expect(engineAny.currentBeatIndex).toBe(0);

    audioNow = 1.05;
    engineAny.tick();
    expect(engineAny.currentBeatIndex).toBe(1);

    audioNow = 2.4;
    engineAny.tick();
    expect(engineAny.currentBeatIndex).toBe(2);
    engine.stopJukebox();
  });

  it("syncs next audio boundary to current playback position", () => {
    let audioNow = 6;
    let trackNow = 2.25;
    const player = makePlayer();
    player.getAudioTime = () => audioNow;
    player.getCurrentTime = () => trackNow;
    const engine = new JukeboxEngine(player);
    engine.loadAnalysis(makeAnalysisPayload(5));

    const engineAny = engine as unknown as {
      currentBeatIndex: number;
      nextAudioTime: number;
    };
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 3;

    audioNow = 25;
    trackNow = 2.25;
    engine.syncToPlaybackPosition();

    expect(engineAny.currentBeatIndex).toBe(2);
    expect(engineAny.nextAudioTime).toBeCloseTo(25.75, 5);
  });

  it("syncing after pause clears a pending scheduled jump", () => {
    let audioNow = 10;
    let trackNow = 1.25;
    const player = makePlayer();
    player.getAudioTime = () => audioNow;
    player.getCurrentTime = () => trackNow;
    const engine = new JukeboxEngine(player);
    engine.loadAnalysis(makeAnalysisPayload(4));
    (player.cancelScheduledJump as ReturnType<typeof vi.fn>).mockClear();
    const engineAny = engine as unknown as {
      pendingAdvance: {
        boundaryAudioTime: number;
        chosenIndex: number;
        shouldJump: boolean;
        targetTime: number | null;
        jumpFromIndex: number | null;
        sourceBoundaryTime: number | null;
      } | null;
    };
    engineAny.pendingAdvance = {
      boundaryAudioTime: 11,
      chosenIndex: 0,
      shouldJump: true,
      targetTime: 0,
      jumpFromIndex: 3,
      sourceBoundaryTime: 4,
    };

    audioNow = 20;
    trackNow = 2.1;
    engine.syncToPlaybackPosition();

    expect(player.cancelScheduledJump).toHaveBeenCalledTimes(1);
    expect(engineAny.pendingAdvance).toBeNull();
  });

  it("seeking to a beat clears pending jump state and repeat history", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    engine.loadAnalysis(makeAnalysisPayload(4));
    (player.cancelScheduledJump as ReturnType<typeof vi.fn>).mockClear();
    const engineAny = engine as unknown as {
      pendingAdvance: {
        boundaryAudioTime: number;
        chosenIndex: number;
        shouldJump: boolean;
        targetTime: number | null;
        jumpFromIndex: number | null;
        sourceBoundaryTime: number | null;
      } | null;
      branchState: { lastDestBySource: Map<number, number> | null };
      currentBeatIndex: number;
    };
    engineAny.pendingAdvance = {
      boundaryAudioTime: 11,
      chosenIndex: 0,
      shouldJump: true,
      targetTime: 0,
      jumpFromIndex: 3,
      sourceBoundaryTime: 4,
    };
    engineAny.branchState.lastDestBySource = new Map([[2, 0]]);

    engine.seekToBeat(2);

    expect(engineAny.currentBeatIndex).toBe(2);
    expect(player.cancelScheduledJump).toHaveBeenCalledTimes(1);
    expect(engineAny.pendingAdvance).toBeNull();
    expect(engineAny.branchState.lastDestBySource).toBeNull();
  });

  it("clamps beat lookup at track boundaries", () => {
    const engine = new JukeboxEngine(makePlayer());
    engine.loadAnalysis(makeAnalysisPayload(4));

    expect(engine.getBeatAtTime(-10)?.which).toBe(0);
    expect(engine.getBeatAtTime(0)?.which).toBe(0);
    expect(engine.getBeatAtTime(3.99)?.which).toBe(3);
    expect(engine.getBeatAtTime(99)?.which).toBe(3);
  });
});

describe("JukeboxEngine branching controls", () => {
  it("forces a branch when forceBranch is enabled", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[2],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[2].neighbors = [edge];
    beats[2].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 99,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engine.setForceBranch(true);
    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(engineAny.lastJumpFromIndex).toBe(2);
  });

  it("ignores forced branching when Bring It Home mode is enabled", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[2],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[2].neighbors = [edge];
    beats[2].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 99,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engine.setForceBranch(true);
    engine.setBringItHomeMode(true);
    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(2);
    expect(player.scheduleJump).not.toHaveBeenCalled();
  });

  it("stops at the final beat in Bring It Home mode instead of wrapping", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    const beats = [0, 1].map(makeBeat);
    linkBeats(beats);
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 0,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      ticking: boolean;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 2;
    engineAny.ticking = true;

    engine.setBringItHomeMode(true);
    engineAny.advanceBeat(2);

    expect(engineAny.currentBeatIndex).toBe(1);
    expect(engineAny.ticking).toBe(false);
    expect(engineAny.nextAudioTime).toBe(Number.POSITIVE_INFINITY);
    expect(player.scheduleJump).not.toHaveBeenCalled();
  });
});

describe("JukeboxEngine graph maintenance", () => {
  it("deletes edges from neighbors and graph storage", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    engine.loadAnalysis(makeAnalysisPayload(3));
    const engineAny = engine as unknown as {
      beats: QuantumBase[];
      graph: JukeboxGraphState;
    };
    const beat = engineAny.beats[0];
    expect(beat.neighbors.length).toBeGreaterThan(0);
    const edge = beat.neighbors[0];
    engine.deleteEdge(edge);
    const graphEdge = engineAny.graph.allEdges.find(
      (candidate) =>
        candidate.src.which === edge.src.which &&
        candidate.dest.which === edge.dest.which
    );
    expect(graphEdge?.deleted).toBe(true);
    expect(beat.neighbors.find((candidate) => candidate === edge)).toBeUndefined();
  });

  it("does not select a deleted edge for branching", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 1,
        maxRandomBranchChance: 1,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[1].neighbors = [edge];
    beats[1].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    const beat = beats[1];
    engine.deleteEdge(edge);
    expect(beat.neighbors.some((candidate) => candidate.deleted)).toBe(false);
    engineAny.currentBeatIndex = beat.which;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;
    engineAny.advanceBeat(engineAny.nextAudioTime);
    const called = (player.scheduleJump as ReturnType<typeof vi.fn>).mock.calls;
    if (called.length > 0) {
      const [targetTime] = called[0];
      expect(targetTime).not.toBe(edge.dest.start);
    }
  });

  it("uses a user-selected anchor edge for visualization and forced anchor jumps", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      randomMode: "seeded",
      seed: 1,
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2, 3].map(makeBeat);
    linkBeats(beats);
    const defaultEdge: Edge = {
      id: 1,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    const userEdge: Edge = {
      id: 3,
      src: beats[3],
      dest: beats[0],
      distance: 5,
      deleted: false,
    };
    beats[1].neighbors = [defaultEdge];
    beats[1].allNeighbors = [defaultEdge];
    beats[3].neighbors = [userEdge];
    beats[3].allNeighbors = [userEdge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [defaultEdge, userEdge],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    expect(engine.getVisualizationData()?.anchorEdgeId).toBe(defaultEdge.id);
    engine.setUserAnchorEdge(userEdge);

    expect(engine.getUserAnchorEdgeId()).toBe(userEdge.id);
    expect(engine.getVisualizationData()?.anchorEdgeId).toBe(userEdge.id);
    expect(engine.getVisualizationData()?.userAnchorEdgeId).toBe(userEdge.id);

    engineAny.currentBeatIndex = 0;
    engineAny.nextAudioTime = 1;
    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(1);
    expect(player.scheduleJump).not.toHaveBeenCalled();

    engineAny.currentBeatIndex = 2;
    engineAny.nextAudioTime = 3;
    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 3);

    engine.setUserAnchorEdge(null);
    expect(engine.getUserAnchorEdgeId()).toBeNull();
    expect(engine.getVisualizationData()?.anchorEdgeId).toBe(defaultEdge.id);
    expect(engine.getVisualizationData()?.userAnchorEdgeId).toBeNull();
  });

  it("falls back to the default anchor when the user anchor is deleted", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    const beats = [0, 1, 2, 3].map(makeBeat);
    linkBeats(beats);
    const defaultEdge: Edge = {
      id: 1,
      src: beats[3],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    const userEdge: Edge = {
      id: 2,
      src: beats[2],
      dest: beats[0],
      distance: 5,
      deleted: false,
    };
    beats[3].neighbors = [defaultEdge];
    beats[3].allNeighbors = [defaultEdge];
    beats[2].neighbors = [userEdge];
    beats[2].allNeighbors = [userEdge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 3,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [defaultEdge, userEdge],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;

    engine.setUserAnchorEdge(userEdge);
    engine.deleteEdge(userEdge);

    expect(engine.getUserAnchorEdgeId()).toBeNull();
    expect(engine.getVisualizationData()?.anchorEdgeId).toBe(defaultEdge.id);
    expect(engine.getVisualizationData()?.userAnchorEdgeId).toBeNull();
  });

  it("does not take forward branches that skip past a user-selected anchor", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 1,
        maxRandomBranchChance: 1,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2, 3, 4, 5].map(makeBeat);
    linkBeats(beats);
    const safeEdge: Edge = {
      id: 1,
      src: beats[1],
      dest: beats[0],
      distance: 100,
      deleted: false,
    };
    const skipPastAnchorEdge: Edge = {
      id: 2,
      src: beats[1],
      dest: beats[5],
      distance: 1,
      deleted: false,
    };
    const userAnchorEdge: Edge = {
      id: 3,
      src: beats[4],
      dest: beats[0],
      distance: 1,
      deleted: false,
    };
    beats[1].neighbors = [skipPastAnchorEdge, safeEdge];
    beats[1].allNeighbors = [skipPastAnchorEdge, safeEdge];
    beats[4].neighbors = [userAnchorEdge];
    beats[4].allNeighbors = [userAnchorEdge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 4,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [safeEdge, skipPastAnchorEdge, userAnchorEdge],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 0;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;
    engine.setUserAnchorEdge(userAnchorEdge);

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 1);
  });
});

describe("JukeboxEngine jump timing", () => {
  it("clamps jump offset to min and max bounds", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 1 });
    const beats = [
      { which: 0, start: 0, duration: 0.1 },
      { which: 1, start: 0.1, duration: 10 },
    ].map((beat) => ({
      ...beat,
      prev: null,
      next: null,
      overlappingSegments: [],
      neighbors: [],
      allNeighbors: [],
    })) as QuantumBase[];
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[0],
      dest: beats[1],
      distance: 10,
      deleted: false,
    };
    beats[0].neighbors = [edge];
    beats[0].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 99,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextAudioTime = 1;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engine.setForceBranch(true);
    engineAny.advanceBeat(engineAny.nextAudioTime);
    const [targetTime] = (player.scheduleJump as ReturnType<typeof vi.fn>).mock.calls[0];
    const offset = targetTime - beats[1].start;
    expect(offset).toBe(0);
  });

  it("scales beat-boundary timing by playback rate", () => {
    const player = makePlayer();
    player.getPlaybackRate = () => 1.2;
    const engine = new JukeboxEngine(player, {
      randomMode: "seeded",
      seed: 1,
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: -1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [],
    };
    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextAudioTime: number;
      curRandomBranchChance: number;
      advanceBeat: (audioTime: number) => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 0;
    engineAny.nextAudioTime = 5;
    engineAny.curRandomBranchChance = 0;

    engineAny.advanceBeat(5);

    expect(engineAny.currentBeatIndex).toBe(1);
    expect(engineAny.nextAudioTime).toBeCloseTo(5 + 1 / 1.2, 6);
  });

  it("falls back to normal speed for invalid playback rates", () => {
    for (const playbackRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const player = makePlayer();
      player.getPlaybackRate = () => playbackRate;
      const engine = new JukeboxEngine(player, {
        config: {
          minRandomBranchChance: 0,
          maxRandomBranchChance: 0,
          randomBranchChanceDelta: 0,
        },
      });
      const beats = [0, 1].map(makeBeat);
      linkBeats(beats);
      const graph: JukeboxGraphState = {
        computedThreshold: 0,
        currentThreshold: 0,
        lastBranchPoint: -1,
        totalBeats: beats.length,
        longestReach: 0,
        allEdges: [],
      };
      const engineAny = engine as unknown as {
        analysis: TrackAnalysis;
        graph: JukeboxGraphState;
        beats: QuantumBase[];
        currentBeatIndex: number;
        nextAudioTime: number;
        curRandomBranchChance: number;
        advanceBeat: (audioTime: number) => void;
      };
      engineAny.analysis = makeAnalysis(beats);
      engineAny.graph = graph;
      engineAny.beats = beats;
      engineAny.currentBeatIndex = 0;
      engineAny.nextAudioTime = 5;
      engineAny.curRandomBranchChance = 0;

      engineAny.advanceBeat(5);

      expect(engineAny.nextAudioTime).toBe(6);
    }
  });

  it("advances once per beat when audio time crosses boundaries", () => {
    vi.useFakeTimers();
    let audioNow = 0.94;
    const player = makePlayer();
    player.getAudioTime = () => audioNow;
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    engine.loadAnalysis(makeAnalysisPayload(3));
    engine.startJukebox();
    vi.advanceTimersByTime(60);
    const engineAny = engine as unknown as { currentBeatIndex: number; beatsPlayed: number };
    expect(engineAny.currentBeatIndex).toBe(0);
    expect(engineAny.beatsPlayed).toBe(1);
    audioNow = 1.96;
    vi.advanceTimersByTime(1100);
    expect(engineAny.currentBeatIndex).toBe(1);
    expect(engineAny.beatsPlayed).toBe(2);
    engine.stopJukebox();
  });
});

describe("JukeboxEngine deleted edges across rebuild", () => {
  it("preserves deleted edge flags in graph storage after rebuild", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        currentThreshold: 80,
        maxBranchThreshold: 80,
      },
    });
    engine.loadAnalysis(makeAnalysisPayload(8));
    const before = engine.getGraphState();
    expect(before).toBeTruthy();
    expect((before?.allEdges.length ?? 0)).toBeGreaterThan(0);
    if (!before || before.allEdges.length === 0) {
      throw new Error("Expected graph edges before deletion");
    }

    const toDelete = before.allEdges[0];
    const deletedKey = `${toDelete.src.which}-${toDelete.dest.which}`;
    engine.deleteEdge(toDelete);
    engine.rebuildGraph();

    const after = engine.getGraphState();
    expect(after).toBeTruthy();
    expect((after?.allEdges.length ?? 0)).toBeGreaterThan(0);
    const matched = after?.allEdges.find(
      (edge) => `${edge.src.which}-${edge.dest.which}` === deletedKey,
    );
    expect(matched).toBeTruthy();
    expect(matched?.deleted).toBe(true);
  });

  it("clears prior deletions after reset before tracking new deletions", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        currentThreshold: 80,
        maxBranchThreshold: 80,
      },
    });
    engine.loadAnalysis(makeAnalysisPayload(8));
    const initial = engine.getGraphState();
    expect(initial).toBeTruthy();
    expect((initial?.allEdges.length ?? 0)).toBeGreaterThan(1);
    if (!initial || initial.allEdges.length < 2) {
      throw new Error("Expected at least two graph edges");
    }

    const firstEdge = initial.allEdges[0];
    const firstKey = `${firstEdge.src.which}-${firstEdge.dest.which}`;
    engine.deleteEdge(firstEdge);
    engine.rebuildGraph();

    engine.clearDeletedEdges();
    engine.rebuildGraph();
    const afterReset = engine.getGraphState();
    const resetDeleted =
      afterReset?.allEdges.filter((edge) => edge.deleted) ?? [];
    expect(resetDeleted.length).toBe(0);
    if (!afterReset) {
      throw new Error("Expected graph state after reset");
    }
    const secondEdge = afterReset.allEdges.find(
      (edge) => `${edge.src.which}-${edge.dest.which}` !== firstKey,
    );
    if (!secondEdge) {
      throw new Error("Expected a second edge after reset");
    }
    const secondKey = `${secondEdge.src.which}-${secondEdge.dest.which}`;

    engine.deleteEdge(secondEdge);
    engine.rebuildGraph();
    const finalGraph = engine.getGraphState();
    const finalDeleted =
      finalGraph?.allEdges.filter((edge) => edge.deleted) ?? [];
    expect(finalDeleted.length).toBe(1);
    const finalKey = `${finalDeleted[0].src.which}-${finalDeleted[0].dest.which}`;
    expect(finalKey).toBe(secondKey);
    expect(finalKey).not.toBe(firstKey);
  });
});
