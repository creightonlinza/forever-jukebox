import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import type { Edge, JukeboxGraphState, QuantumBase, TrackAnalysis } from "./types";

type FixtureCase = {
  id: string;
  beats: number;
  initialLastBranchPoint: number;
  edges: Array<[number, number, number, number]>;
  deleteEdgeIds: number[];
  expected: {
    lastBranchPoint: number;
    anchorEdgeId: number | null;
  };
};

type FixtureDoc = {
  schema_version: number;
  cases: FixtureCase[];
};

function loadFixture(): FixtureDoc {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    currentDir,
    "../../../test-fixtures/engine-parity/rebuild-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => true,
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
    track: { duration: count },
  };
}

function makeEdge(
  id: number,
  src: QuantumBase,
  dest: QuantumBase,
  distance: number,
): Edge {
  return {
    id,
    src,
    dest,
    distance,
    deleted: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rebuild parity fixtures", () => {
  it("matches shared rebuild/delete expectations", () => {
    const fixture = loadFixture();
    const mockedBuild = vi.mocked(buildJumpGraph);

    for (const testCase of fixture.cases) {
      mockedBuild.mockImplementation((analysis: TrackAnalysis) => {
        for (const beat of analysis.beats) {
          beat.neighbors = [];
          beat.allNeighbors = [];
        }
        const allEdges = testCase.edges.map(([id, src, dest, distance]) =>
          makeEdge(id, analysis.beats[src], analysis.beats[dest], distance),
        );
        for (const edge of allEdges) {
          edge.src.neighbors.push(edge);
          edge.src.allNeighbors.push(edge);
        }
        return {
          computedThreshold: 10,
          currentThreshold: 10,
          lastBranchPoint: testCase.initialLastBranchPoint,
          totalBeats: analysis.beats.length,
          longestReach: 0,
          allEdges,
        } satisfies JukeboxGraphState;
      });

      const engine = new JukeboxEngine(makePlayer());
      engine.loadAnalysis(makeAnalysisPayload(testCase.beats));
      const graph = engine.getGraphState();
      for (const edgeId of testCase.deleteEdgeIds) {
        const edge = graph?.allEdges.find((candidate) => candidate.id === edgeId);
        if (!edge) {
          throw new Error(`${testCase.id}: expected edge ${edgeId} missing`);
        }
        engine.deleteEdge(edge);
      }
      engine.rebuildGraph();

      const after = engine.getGraphState();
      expect(after?.lastBranchPoint, `${testCase.id}: lastBranchPoint`).toBe(
        testCase.expected.lastBranchPoint,
      );
      const viz = engine.getVisualizationData();
      expect(viz?.anchorEdgeId ?? null, `${testCase.id}: anchorEdgeId`).toBe(
        testCase.expected.anchorEdgeId,
      );
    }
  });
});
