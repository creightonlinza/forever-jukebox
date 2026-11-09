import { describe, expect, it, vi } from "vitest";
import { JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";
import {
  CUSTOM_ANCHOR_EDGE_ID,
  isValidCustomAnchor,
  MIN_CUSTOM_ANCHOR_GAP,
  selectNextBeatIndex,
} from "./selection";

function makePlayer(): JukeboxPlayer & {
  setAnchorJump: ReturnType<typeof vi.fn>;
  clearAnchorJump: ReturnType<typeof vi.fn>;
} {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(() => true),
    cancelScheduledJump: vi.fn(),
    setAnchorJump: vi.fn(() => true),
    clearAnchorJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => false,
  };
}

function makeAnalysisPayload(count: number) {
  const beats = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
  }));
  const segments = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
    loudness_start: -20,
    loudness_max: -10,
    loudness_max_time: 0.1,
    pitches: Array.from({ length: 12 }, (_v, p) => ((i + p) % 12) / 12),
    timbre: Array.from({ length: 12 }, (_v, t) => ((i * 7 + t) % 13) * 3),
  }));
  return {
    sections: [{ start: 0, duration: count, confidence: 1 }],
    bars: beats,
    beats,
    tatums: beats,
    segments,
    track: { duration: count },
  };
}

function loadedEngine(count = 32) {
  const player = makePlayer();
  const engine = new JukeboxEngine(player);
  engine.loadAnalysis(makeAnalysisPayload(count));
  return { engine, player };
}

describe("isValidCustomAnchor", () => {
  it("accepts a backward pair at the minimum gap", () => {
    expect(isValidCustomAnchor(32, 10, 10 - MIN_CUSTOM_ANCHOR_GAP)).toBe(true);
  });

  it("rejects forward, short, out-of-range and non-integer pairs", () => {
    expect(isValidCustomAnchor(32, 4, 20)).toBe(false);
    expect(isValidCustomAnchor(32, 10, 10 - MIN_CUSTOM_ANCHOR_GAP + 1)).toBe(false);
    expect(isValidCustomAnchor(32, 32, 0)).toBe(false);
    expect(isValidCustomAnchor(32, 10, -1)).toBe(false);
    expect(isValidCustomAnchor(32, 10.5, 2)).toBe(false);
    expect(isValidCustomAnchor(32, Number.NaN, 2)).toBe(false);
  });
});

describe("JukeboxEngine custom anchor", () => {
  it("rejects invalid input without changing the anchor", () => {
    const { engine } = loadedEngine();
    expect(engine.setCustomAnchor(20, 5)).toBe(true);
    expect(engine.setCustomAnchor(5, 20)).toBe(false);
    expect(engine.setCustomAnchor(99, 5)).toBe(false);
    expect(engine.getCustomAnchor()).toEqual({ src: 20, dest: 5 });
  });

  it("returns false before an analysis is loaded", () => {
    const engine = new JukeboxEngine(makePlayer());
    expect(engine.setCustomAnchor(20, 5)).toBe(false);
  });

  it("arms the player jump at the custom pair", () => {
    const { engine, player } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    expect(player.setAnchorJump).toHaveBeenLastCalledWith(5, 20);
    expect(engine.getActiveAnchor()).toEqual({ src: 20, dest: 5 });
  });

  it("exposes the custom edge to the visualization as the user anchor", () => {
    const { engine } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    const data = engine.getVisualizationData();
    expect(data?.userAnchorEdgeId).toBe(CUSTOM_ANCHOR_EDGE_ID);
    expect(data?.anchorEdgeId).toBe(CUSTOM_ANCHOR_EDGE_ID);
    const edge = data?.edges.find((candidate) => candidate.id === CUSTOM_ANCHOR_EDGE_ID);
    expect(edge?.src.which).toBe(20);
    expect(edge?.dest.which).toBe(5);
  });

  it("forces the jump when playback reaches the custom source", () => {
    const { engine } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    const graph = engine.getGraphState()!;
    const seed = engine.getVisualizationData()!.beats[20];
    const result = selectNextBeatIndex(
      seed,
      graph,
      engine.getConfig(),
      () => 0.99,
      { curRandomBranchChance: 0 },
      false,
      { edgeId: CUSTOM_ANCHOR_EDGE_ID, sourceIndex: 20 },
    );
    expect(result).toEqual({ index: 5, jumped: true });
  });

  it("survives a graph rebuild after a tuning change", () => {
    const { engine } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    engine.updateConfig({ justBackwards: true, currentThreshold: 1 });
    engine.rebuildGraph();
    expect(engine.getUserAnchorEdgeId()).toBe(CUSTOM_ANCHOR_EDGE_ID);
    const neighbors = engine.getVisualizationData()?.beats[20].neighbors ?? [];
    expect(neighbors.filter((edge) => edge.id === CUSTOM_ANCHOR_EDGE_ID)).toHaveLength(1);
  });

  it("stays out of allEdges, so deleted ids never include it", () => {
    const { engine } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    const ids = engine.getGraphState()?.allEdges.map((edge) => edge.id) ?? [];
    expect(ids).not.toContain(CUSTOM_ANCHOR_EDGE_ID);
  });

  it("replaces the previous custom edge instead of stacking it", () => {
    const { engine } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    engine.setCustomAnchor(24, 8);
    const beats = engine.getVisualizationData()?.beats ?? [];
    expect(beats[20].neighbors.some((edge) => edge.id === CUSTOM_ANCHOR_EDGE_ID)).toBe(false);
    expect(beats[24].neighbors.some((edge) => edge.id === CUSTOM_ANCHOR_EDGE_ID)).toBe(true);
  });

  it("clears on delete, on a pinned anchor, on tuning reset and on a new analysis", () => {
    const { engine } = loadedEngine();
    engine.setCustomAnchor(20, 5);
    const custom = engine.getUserAnchorEdge();
    expect(custom).not.toBeNull();
    engine.deleteEdge(custom!);
    expect(engine.getCustomAnchor()).toBeNull();
    expect(engine.getGraphState()?.allEdges.some((edge) => edge.deleted)).toBe(false);

    engine.setCustomAnchor(20, 5);
    engine.setUserAnchorEdge(null);
    expect(engine.getCustomAnchor()).toBeNull();

    engine.setCustomAnchor(20, 5);
    engine.clearDeletedEdges();
    expect(engine.getCustomAnchor()).toBeNull();

    engine.setCustomAnchor(20, 5);
    engine.loadAnalysis(makeAnalysisPayload(32));
    expect(engine.getCustomAnchor()).toBeNull();
  });

  it("keeps the custom edge when the real edge for the same pair is deleted", () => {
    const { engine } = loadedEngine();
    const real = engine
      .getGraphState()
      ?.allEdges.find((edge) => edge.dest.which < edge.src.which - MIN_CUSTOM_ANCHOR_GAP);
    expect(real).toBeDefined();
    engine.deleteEdge(real!);
    engine.rebuildGraph();
    expect(engine.setCustomAnchor(real!.src.which, real!.dest.which)).toBe(true);
    engine.rebuildGraph();
    expect(engine.getCustomAnchor()).toEqual({
      src: real!.src.which,
      dest: real!.dest.which,
    });
  });
});
