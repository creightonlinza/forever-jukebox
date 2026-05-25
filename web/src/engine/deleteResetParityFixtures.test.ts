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

type FixturePhaseExpectation = {
  lastBranchPoint: number;
  anchorEdgeId: number | null;
  deletedEdgeIds: number[];
};

type FixtureCase = {
  id: string;
  beats: number;
  initialLastBranchPoint: number;
  edges: Array<[number, number, number, number]>;
  firstDeleteEdgeId: number;
  secondDeleteEdgeId: number;
  expected: {
    afterFirstDelete: FixturePhaseExpectation;
    afterReset: FixturePhaseExpectation;
    afterSecondDelete: FixturePhaseExpectation;
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
    "../../../test-fixtures/engine-parity/delete-reset-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(() => true),
    cancelScheduledJump: vi.fn(),
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

function snapshot(engine: JukeboxEngine): FixturePhaseExpectation {
  const graph = engine.getGraphState();
  const viz = engine.getVisualizationData();
  return {
    lastBranchPoint: graph?.lastBranchPoint ?? -1,
    anchorEdgeId: viz?.anchorEdgeId ?? null,
    deletedEdgeIds: (graph?.allEdges ?? [])
      .filter((edge) => edge.deleted)
      .map((edge) => edge.id)
      .sort((a, b) => a - b),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("delete/reset parity fixtures", () => {
  it("matches shared delete-reset-delete expectations", () => {
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

      const firstEdge = engine
        .getGraphState()
        ?.allEdges.find((candidate) => candidate.id === testCase.firstDeleteEdgeId);
      if (!firstEdge) {
        throw new Error(`${testCase.id}: missing first edge ${testCase.firstDeleteEdgeId}`);
      }
      engine.deleteEdge(firstEdge);
      engine.rebuildGraph();
      expect(snapshot(engine), `${testCase.id}: afterFirstDelete`).toEqual(
        testCase.expected.afterFirstDelete,
      );

      engine.clearDeletedEdges();
      engine.rebuildGraph();
      expect(snapshot(engine), `${testCase.id}: afterReset`).toEqual(
        testCase.expected.afterReset,
      );

      const secondEdge = engine
        .getGraphState()
        ?.allEdges.find((candidate) => candidate.id === testCase.secondDeleteEdgeId);
      if (!secondEdge) {
        throw new Error(`${testCase.id}: missing second edge ${testCase.secondDeleteEdgeId}`);
      }
      engine.deleteEdge(secondEdge);
      engine.rebuildGraph();
      expect(snapshot(engine), `${testCase.id}: afterSecondDelete`).toEqual(
        testCase.expected.afterSecondDelete,
      );
    }
  });
});
