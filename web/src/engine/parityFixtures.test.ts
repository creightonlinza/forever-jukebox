import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJumpGraph } from "./graph";
import { getBestLastBranchNeighborIndex, selectNextBeatIndex } from "./selection";
import type { Edge, JukeboxConfig, QuantumBase, TrackAnalysis } from "./types";

type FixtureCase = {
  id: string;
  beats: number;
  config: {
    currentThreshold: number;
    minLongBranch: number;
  };
  edges: Array<[number, number, number]>;
  expected: {
    lastBranchPoint: number;
    forcedDest: number;
    forcedInserted: boolean;
  };
  jumpExpectation: {
    nextIndex: number;
    jumped: boolean;
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
    minRandomBranchChance: 0.1,
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
    "../../../test-fixtures/engine-parity/anchor-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

describe("engine parity fixtures", () => {
  it("matches expected anchor signatures for shared fixture cases", () => {
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
      const graph = buildJumpGraph(
        analysis,
        defaultConfig({
          currentThreshold: testCase.config.currentThreshold,
          minLongBranch: testCase.config.minLongBranch,
        }),
      );
      const source = analysis.beats[graph.lastBranchPoint];
      expect(source, `${testCase.id}: selected source exists`).toBeDefined();
      if (!source) {
        throw new Error(`${testCase.id}: selected source missing`);
      }
      const forcedIndex = getBestLastBranchNeighborIndex(source);
      const forced = source.neighbors[forcedIndex];
      expect(forced, `${testCase.id}: forced edge exists`).toBeDefined();
      if (!forced) {
        throw new Error(`${testCase.id}: forced edge missing`);
      }

      const signature = {
        lastBranchPoint: graph.lastBranchPoint,
        forcedDest: forced.dest.which,
        forcedInserted: forced.distance > graph.currentThreshold,
      };
      expect(signature).toEqual(testCase.expected);

      const jumpResult = selectNextBeatIndex(
        source,
        graph,
        defaultConfig({
          currentThreshold: testCase.config.currentThreshold,
          minLongBranch: testCase.config.minLongBranch,
        }),
        () => 0.99,
        { curRandomBranchChance: 0.18 },
        false,
      );
      expect({
        nextIndex: jumpResult.index,
        jumped: jumpResult.jumped,
      }).toEqual(testCase.jumpExpectation);
    }
  });
});
