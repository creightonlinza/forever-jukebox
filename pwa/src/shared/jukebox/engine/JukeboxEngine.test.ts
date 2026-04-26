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
});
