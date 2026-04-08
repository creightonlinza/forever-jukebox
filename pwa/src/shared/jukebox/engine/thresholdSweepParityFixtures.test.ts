import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJumpGraph } from "./graph";
import { getBestLastBranchNeighborIndex } from "./selection";
import type { Edge, JukeboxConfig, QuantumBase, TrackAnalysis } from "./types";

type FixtureExpectation = {
  threshold: number;
  lastBranchPoint: number;
  forcedDest: number | null;
  forcedInserted: boolean;
};

type FixtureCase = {
  id: string;
  beats: number;
  config: {
    minLongBranch: number;
  };
  edges: Array<[number, number, number]>;
  expected: FixtureExpectation[];
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
    "../../../../../test-fixtures/engine-parity/threshold-sweep-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

describe("PWA threshold-sweep parity fixtures", () => {
  it("matches expected anchor signature across threshold sweeps", () => {
    const fixture = loadFixture();
    for (const testCase of fixture.cases) {
      for (const expected of testCase.expected) {
        const analysis = makeAnalysis(testCase.beats);
        let edgeId = 0;
        for (const [src, dest, distance] of testCase.edges) {
          analysis.beats[src].allNeighbors.push(
            makeEdge(edgeId, analysis.beats[src], analysis.beats[dest], distance),
          );
          edgeId += 1;
        }

        const graph = buildJumpGraph(
          analysis,
          defaultConfig({
            currentThreshold: expected.threshold,
            minLongBranch: testCase.config.minLongBranch,
          }),
        );

        let forcedDest: number | null = null;
        let forcedInserted = false;
        const source = analysis.beats[graph.lastBranchPoint];
        if (source && source.neighbors.length > 0) {
          const forced = source.neighbors[getBestLastBranchNeighborIndex(source)];
          if (forced) {
            forcedDest = forced.dest.which;
            forcedInserted = forced.distance > graph.currentThreshold;
          }
        }

        expect(
          {
            lastBranchPoint: graph.lastBranchPoint,
            forcedDest,
            forcedInserted,
          },
          `${testCase.id}@${expected.threshold}`,
        ).toEqual({
          lastBranchPoint: expected.lastBranchPoint,
          forcedDest: expected.forcedDest,
          forcedInserted: expected.forcedInserted,
        });
      }
    }
  });
});
