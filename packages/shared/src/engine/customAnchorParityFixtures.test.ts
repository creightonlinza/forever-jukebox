import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "./analysis";
import { beatPairDistance, buildJumpGraph } from "./graph";
import { createRng } from "./random";
import {
  createCustomAnchorEdge,
  parseAnchorParam,
  selectNextBeatIndex,
  type BranchState,
} from "./selection";
import type { JukeboxConfig } from "./types";

// The `ab` wire format and custom anchor playback, shared with forever-jukebox-android:
// both repos parse the same strings and replay the same seeded sequences.
type ParamCase = { raw: string; expected: { edgeId: number } | { src: number; dest: number } | null };

type SequenceCase = {
  id: string;
  anchor: string;
  seed: number;
  steps: number;
  config: JukeboxConfig;
  expected: {
    pairDistance: number;
    sameBarPosition: boolean;
    jumpCount: number;
    jumps: Array<[number, number, number]>;
    beatSequence: number[];
  };
};

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../test-fixtures/engine-parity",
);
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "custom-anchor-cases.json"), "utf8"),
) as { analysis_source: string; param_cases: ParamCase[]; sequence_cases: SequenceCase[] };
const analysisDoc = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, fixture.analysis_source), "utf8"),
) as { analysis: unknown };

// Mirrors JukeboxEngine: the custom edge joins its source beat's neighbors after the graph is built.
function replay(testCase: SequenceCase) {
  const analysis = normalizeAnalysis(analysisDoc.analysis);
  const graph = buildJumpGraph(analysis, testCase.config);
  const parsed = parseAnchorParam(testCase.anchor);
  expect(parsed && "custom" in parsed, `${testCase.id}: anchor parses as a pair`).toBe(true);
  const edge = createCustomAnchorEdge(analysis.beats, (parsed as { custom: { src: number; dest: number } }).custom)!;
  edge.src.neighbors.push(edge);
  const userAnchor = { edgeId: edge.id, sourceIndex: edge.src.which };
  const rng = createRng("seeded", testCase.seed);
  const state: BranchState = { curRandomBranchChance: testCase.config.minRandomBranchChance };
  const beats = analysis.beats;
  const beatSequence: number[] = [];
  const jumps: Array<[number, number, number]> = [];
  let current = 0;
  for (let step = 0; step < testCase.steps; step += 1) {
    const seedIndex = (current + 1) % beats.length;
    const selection = selectNextBeatIndex(beats[seedIndex], graph, testCase.config, rng, state, false, userAnchor);
    if (selection.jumped) {
      jumps.push([step, seedIndex, selection.index]);
      current = selection.index;
    } else {
      current = seedIndex;
    }
    beatSequence.push(current);
  }
  return {
    pairDistance: Math.round(beatPairDistance(edge.src, edge.dest) * 1_000_000) / 1_000_000,
    sameBarPosition: edge.src.indexInParent === edge.dest.indexInParent,
    jumpCount: jumps.length,
    jumps,
    beatSequence,
  };
}

describe("custom anchor parity fixtures", () => {
  it("parses every ab value the same way", () => {
    for (const testCase of fixture.param_cases) {
      const parsed = parseAnchorParam(testCase.raw);
      const actual =
        parsed === null
          ? null
          : "edgeId" in parsed
            ? { edgeId: parsed.edgeId }
            : { src: parsed.custom.src, dest: parsed.custom.dest };
      expect(actual, JSON.stringify(testCase.raw)).toEqual(testCase.expected);
    }
  });

  it("replays the seeded sequence with a custom anchor", () => {
    for (const testCase of fixture.sequence_cases) {
      expect(replay(testCase), testCase.id).toEqual(testCase.expected);
      expect(
        testCase.expected.jumps.some(([, from, to]) => `${from}-${to}` === testCase.anchor),
        `${testCase.id}: the anchor jump is taken`,
      ).toBe(true);
    }
  });
});
