import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJumpGraph } from "./graph";
import type { Edge, JukeboxConfig, QuantumBase, TrackAnalysis } from "./types";

type FixtureCase = {
  id: string;
  beats: number;
  config: Partial<JukeboxConfig> & {
    currentThreshold: number;
    minLongBranch: number;
  };
  edges: Array<[number, number, number]>;
  expected: {
    graph: {
      computedThreshold: number;
      currentThreshold: number;
      lastBranchPoint: number;
      totalBeats: number;
      longestReach: number;
      allEdgesCount: number;
    };
    activeEdges: Array<[number, number, number]>;
    allEdges: Array<[number, number, number, number]>;
  };
};

type FixtureDoc = {
  schema_version: number;
  cases: FixtureCase[];
};

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

function makeAnalysis(totalBeats: number): TrackAnalysis {
  const beats = Array.from({ length: totalBeats }, (_, idx) => makeBeat(idx));
  linkBeats(beats);
  return {
    sections: [],
    bars: [],
    beats,
    tatums: [],
    segments: [],
    track: { duration: totalBeats },
  };
}

function makeEdge(id: number, src: QuantumBase, dest: QuantumBase, distance: number): Edge {
  return {
    id,
    src,
    dest,
    distance,
    deleted: false,
  };
}

function defaultConfig(overrides: Partial<JukeboxConfig>): JukeboxConfig {
  return {
    maxBranches: 4,
    maxBranchThreshold: 80,
    currentThreshold: 20,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.018,
    minLongBranch: 1,
    ...overrides,
  };
}

function loadFixture(): FixtureDoc {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    currentDir,
    "../../../test-fixtures/engine-parity/graph-output-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

describe("graph output parity fixtures", () => {
  it("matches expected graph output signatures for shared fixture cases", () => {
    const fixture = loadFixture();
    for (const testCase of fixture.cases) {
      const analysis = makeAnalysis(testCase.beats);
      let edgeId = 0;
      for (const [src, dest, distance] of testCase.edges) {
        analysis.beats[src].allNeighbors.push(
          makeEdge(edgeId, analysis.beats[src], analysis.beats[dest], distance),
        );
        edgeId += 1;
      }

      const graph = buildJumpGraph(analysis, defaultConfig(testCase.config));
      const actualGraph = {
        computedThreshold: graph.computedThreshold,
        currentThreshold: graph.currentThreshold,
        lastBranchPoint: graph.lastBranchPoint,
        totalBeats: graph.totalBeats,
        longestReach: rounded(graph.longestReach),
        allEdgesCount: graph.allEdges.length,
      };
      expect(actualGraph, `${testCase.id}: graph state`).toEqual(testCase.expected.graph);

      const actualActiveEdges = analysis.beats
        .flatMap((beat) =>
          beat.neighbors.map((edge) => [
            edge.src.which,
            edge.dest.which,
            rounded(edge.distance),
          ]),
        )
        .sort(
          (a, b) =>
            a[0] - b[0] ||
            a[1] - b[1] ||
            (a[2] as number) - (b[2] as number),
        ) as Array<[number, number, number]>;
      expect(actualActiveEdges, `${testCase.id}: active edges`).toEqual(
        testCase.expected.activeEdges,
      );

      const actualAllEdges = graph.allEdges
        .map((edge) => [edge.id, edge.src.which, edge.dest.which, rounded(edge.distance)])
        .sort((a, b) => (a[0] as number) - (b[0] as number)) as Array<
        [number, number, number, number]
      >;
      expect(actualAllEdges, `${testCase.id}: all edges`).toEqual(
        testCase.expected.allEdges,
      );
    }
  });
});

