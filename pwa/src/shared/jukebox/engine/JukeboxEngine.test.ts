import { afterEach, describe, expect, it, vi } from "vitest";
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

function makePlayer(overrides: Partial<JukeboxPlayer> = {}): JukeboxPlayer {
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
    ...overrides,
  };
}

function makeGraph(beats: QuantumBase[], edge: Edge | null): JukeboxGraphState {
  return {
    computedThreshold: 0,
    currentThreshold: 0,
    lastBranchPoint: edge?.src.which ?? 0,
    totalBeats: beats.length,
    longestReach: 0,
    allEdges: edge ? [edge] : [],
  };
}

function installEngineState(
  engine: JukeboxEngine,
  beats: QuantumBase[],
  graph: JukeboxGraphState,
  currentBeatIndex: number,
  nextAudioTime: number,
) {
  const engineAny = engine as unknown as {
    analysis: TrackAnalysis;
    graph: JukeboxGraphState;
    beats: QuantumBase[];
    currentBeatIndex: number;
    nextAudioTime: number;
    curRandomBranchChance: number;
    advanceBeat: (audioTime: number) => void;
    preparePendingAdvance: (audioTime: number) => void;
  };
  engineAny.analysis = makeAnalysis(beats);
  engineAny.graph = graph;
  engineAny.beats = beats;
  engineAny.currentBeatIndex = currentBeatIndex;
  engineAny.nextAudioTime = nextAudioTime;
  engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;
  return engineAny;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PWA JukeboxEngine jump scheduling parity", () => {
  it("schedules selected branches at the source beat boundary", () => {
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
    const engineAny = installEngineState(
      engine,
      beats,
      makeGraph(beats, edge),
      0,
      10.75,
    );

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 1);
  });

  it("uses the final beat end as the source boundary when wrapping", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 2 });
    const beats = [0, 1].map(makeBeat);
    linkBeats(beats);
    const engineAny = installEngineState(
      engine,
      beats,
      makeGraph(beats, null),
      1,
      10.75,
    );

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 2);
  });

  it("fails closed when the first branch boundary is too close", () => {
    const player = makePlayer({ getCurrentTime: () => 0.95 });
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
    const engineAny = installEngineState(
      engine,
      beats,
      makeGraph(beats, edge),
      0,
      10.05,
    );

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(1);
    expect(player.scheduleJump).not.toHaveBeenCalled();
  });

  it("cancels a prepared source-position jump when syncing playback", () => {
    let currentTime = 0.25;
    const player = makePlayer({
      getCurrentTime: () => currentTime,
      getAudioTime: () => 10,
    });
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
    const engineAny = installEngineState(
      engine,
      beats,
      makeGraph(beats, edge),
      0,
      10.75,
    );
    engineAny.preparePendingAdvance(engineAny.nextAudioTime);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);

    currentTime = 0.4;
    engine.syncToPlaybackPosition();

    expect(player.cancelScheduledJump).toHaveBeenCalledTimes(1);
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
    const engineAny = installEngineState(engine, beats, graph, 0, 1);

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
    const engine = new JukeboxEngine(makePlayer());
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
    installEngineState(engine, beats, graph, 0, 1);

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
    const engineAny = installEngineState(engine, beats, graph, 0, 1);
    engine.setUserAnchorEdge(userAnchorEdge);

    engineAny.advanceBeat(engineAny.nextAudioTime);

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledWith(0, 1);
  });
});
