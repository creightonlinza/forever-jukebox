import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./graph", () => ({
  buildJumpGraph: vi.fn(),
}));

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

function makeAnalysisPayload() {
  const beats = [
    { start: 0, duration: 1, confidence: 1 },
    { start: 1, duration: 1, confidence: 1 },
  ];
  const segments = [
    {
      start: 0,
      duration: 1,
      confidence: 1,
      loudness_start: 0,
      loudness_max: 0,
      loudness_max_time: 0,
      pitches: Array(12).fill(0),
      timbre: Array(12).fill(0),
    },
    {
      start: 1,
      duration: 1,
      confidence: 1,
      loudness_start: 0,
      loudness_max: 0,
      loudness_max_time: 0,
      pitches: Array(12).fill(0),
      timbre: Array(12).fill(0),
    },
  ];
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
});
