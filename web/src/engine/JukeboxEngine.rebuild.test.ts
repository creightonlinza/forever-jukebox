import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph")>();
  return {
    ...actual,
    buildJumpGraph: vi.fn(),
  };
});

vi.mock("../shared/backgroundTimer", () => ({
  backgroundSetTimeout: (
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => globalThis.setTimeout(callback, delay, ...args),
  backgroundClearTimeout: (id: number) => globalThis.clearTimeout(id),
}));

import { JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";
import { buildJumpGraph } from "./graph";
import type { Edge, JukeboxGraphState, TrackAnalysis } from "./types";

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    isPlaying: () => true,
  };
}

function makeAnalysisPayload(count = 2) {
  const beats = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
  }));
  const segments = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
    loudness_start: 0,
    loudness_max: 0,
    loudness_max_time: 0,
    pitches: Array(12).fill(0),
    timbre: Array(12).fill(0),
  }));
  return {
    sections: beats,
    bars: beats,
    beats,
    tatums: beats,
    segments,
    track: { duration: 2 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JukeboxEngine rebuildGraph", () => {
  it("resets branch chance and reapplies deleted edges", () => {
    const mockedBuild = vi.mocked(buildJumpGraph);
    mockedBuild.mockImplementation((analysis: TrackAnalysis) => {
      const edge: Edge = {
        id: 0,
        src: analysis.beats[0],
        dest: analysis.beats[1],
        distance: 10,
        deleted: false,
      };
      analysis.beats[0].neighbors = [edge];
      analysis.beats[0].allNeighbors = [edge];
      return {
        computedThreshold: 10,
        currentThreshold: 10,
        lastBranchPoint: 1,
        totalBeats: analysis.beats.length,
        longestReach: 0,
        allEdges: [edge],
      } satisfies JukeboxGraphState;
    });

    const engine = new JukeboxEngine(makePlayer(), {
      config: { minRandomBranchChance: 0.25 },
    });
    engine.loadAnalysis(makeAnalysisPayload());

    const graph = engine.getGraphState();
    expect(graph?.allEdges.length).toBe(1);
    const edge = graph?.allEdges[0];
    expect(edge).toBeTruthy();
    if (!edge) {
      throw new Error("Expected a graph edge to exist");
    }
    engine.deleteEdge(edge);

    const engineAny = engine as unknown as { curRandomBranchChance: number };
    engineAny.curRandomBranchChance = 0.9;
    engine.rebuildGraph();

    expect(engineAny.curRandomBranchChance).toBe(0.25);
    const rebuilt = engine.getGraphState()?.allEdges[0];
    expect(rebuilt?.deleted).toBe(true);
  });

  it("keeps deleted edges filtered out of neighbors after rebuild", () => {
    const mockedBuild = vi.mocked(buildJumpGraph);
    mockedBuild.mockImplementation((analysis: TrackAnalysis) => {
      const edge: Edge = {
        id: 0,
        src: analysis.beats[0],
        dest: analysis.beats[1],
        distance: 10,
        deleted: false,
      };
      analysis.beats[0].neighbors = [edge];
      analysis.beats[0].allNeighbors = [edge];
      return {
        computedThreshold: 10,
        currentThreshold: 10,
        lastBranchPoint: 1,
        totalBeats: analysis.beats.length,
        longestReach: 0,
        allEdges: [edge],
      } satisfies JukeboxGraphState;
    });

    const engine = new JukeboxEngine(makePlayer());
    engine.loadAnalysis(makeAnalysisPayload());
    const graph = engine.getGraphState();
    const edge = graph?.allEdges[0];
    if (!edge) {
      throw new Error("Expected a graph edge to exist");
    }
    engine.deleteEdge(edge);
    engine.rebuildGraph();
    const beat = (engine as unknown as { beats: TrackAnalysis["beats"] }).beats[0];
    expect(beat.neighbors.find((candidate) => candidate.deleted)).toBeUndefined();
  });

  it("reassigns anchor source when deleted edges remove the current anchor branch", () => {
    const mockedBuild = vi.mocked(buildJumpGraph);
    mockedBuild.mockImplementation((analysis: TrackAnalysis) => {
      const edgeA: Edge = {
        id: 0,
        src: analysis.beats[1],
        dest: analysis.beats[0],
        distance: 10,
        deleted: false,
      };
      const edgeB: Edge = {
        id: 1,
        src: analysis.beats[2],
        dest: analysis.beats[0],
        distance: 9,
        deleted: false,
      };
      for (const beat of analysis.beats) {
        beat.neighbors = [];
        beat.allNeighbors = [];
      }
      analysis.beats[1].neighbors = [edgeA];
      analysis.beats[1].allNeighbors = [edgeA];
      analysis.beats[2].neighbors = [edgeB];
      analysis.beats[2].allNeighbors = [edgeB];
      return {
        computedThreshold: 10,
        currentThreshold: 10,
        lastBranchPoint: 1,
        totalBeats: analysis.beats.length,
        longestReach: 0,
        allEdges: [edgeA, edgeB],
      } satisfies JukeboxGraphState;
    });

    const engine = new JukeboxEngine(makePlayer());
    engine.loadAnalysis(makeAnalysisPayload(3));
    const before = engine.getGraphState();
    const anchorEdge = before?.allEdges.find((edge) => edge.src.which === 1);
    if (!anchorEdge) {
      throw new Error("Expected initial anchor edge");
    }

    engine.deleteEdge(anchorEdge);
    engine.rebuildGraph();

    const after = engine.getGraphState();
    expect(after?.lastBranchPoint).toBe(2);
    const viz = engine.getVisualizationData();
    expect(viz?.anchorEdgeId).toBe(1);
  });

  it("falls back to no forced anchor when deleted edges remove all branch sources", () => {
    const mockedBuild = vi.mocked(buildJumpGraph);
    mockedBuild.mockImplementation((analysis: TrackAnalysis) => {
      const edgeA: Edge = {
        id: 0,
        src: analysis.beats[1],
        dest: analysis.beats[0],
        distance: 10,
        deleted: false,
      };
      for (const beat of analysis.beats) {
        beat.neighbors = [];
        beat.allNeighbors = [];
      }
      analysis.beats[1].neighbors = [edgeA];
      analysis.beats[1].allNeighbors = [edgeA];
      return {
        computedThreshold: 10,
        currentThreshold: 10,
        lastBranchPoint: 1,
        totalBeats: analysis.beats.length,
        longestReach: 0,
        allEdges: [edgeA],
      } satisfies JukeboxGraphState;
    });

    const engine = new JukeboxEngine(makePlayer());
    engine.loadAnalysis(makeAnalysisPayload(3));
    const before = engine.getGraphState();
    const onlyEdge = before?.allEdges[0];
    if (!onlyEdge) {
      throw new Error("Expected initial anchor edge");
    }

    engine.deleteEdge(onlyEdge);
    engine.rebuildGraph();

    const after = engine.getGraphState();
    expect(after?.lastBranchPoint).toBe(-1);
    const viz = engine.getVisualizationData();
    expect(viz?.anchorEdgeId).toBeNull();
  });

  it("falls back to no forced anchor when only early-track sources remain after deletion", () => {
    const mockedBuild = vi.mocked(buildJumpGraph);
    mockedBuild.mockImplementation((analysis: TrackAnalysis) => {
      const lateEdge: Edge = {
        id: 0,
        src: analysis.beats[5],
        dest: analysis.beats[0],
        distance: 10,
        deleted: false,
      };
      const earlyEdge: Edge = {
        id: 1,
        src: analysis.beats[2],
        dest: analysis.beats[0],
        distance: 8,
        deleted: false,
      };
      for (const beat of analysis.beats) {
        beat.neighbors = [];
        beat.allNeighbors = [];
      }
      analysis.beats[5].neighbors = [lateEdge];
      analysis.beats[5].allNeighbors = [lateEdge];
      analysis.beats[2].neighbors = [earlyEdge];
      analysis.beats[2].allNeighbors = [earlyEdge];
      return {
        computedThreshold: 10,
        currentThreshold: 10,
        lastBranchPoint: 5,
        totalBeats: analysis.beats.length,
        longestReach: 0,
        allEdges: [lateEdge, earlyEdge],
      } satisfies JukeboxGraphState;
    });

    const engine = new JukeboxEngine(makePlayer());
    engine.loadAnalysis(makeAnalysisPayload(6));
    const before = engine.getGraphState();
    const lateAnchorEdge = before?.allEdges.find((edge) => edge.src.which === 5);
    if (!lateAnchorEdge) {
      throw new Error("Expected initial late anchor edge");
    }

    engine.deleteEdge(lateAnchorEdge);
    engine.rebuildGraph();

    const after = engine.getGraphState();
    expect(after?.lastBranchPoint).toBe(-1);
    const viz = engine.getVisualizationData();
    expect(viz?.anchorEdgeId).toBeNull();
  });

});
