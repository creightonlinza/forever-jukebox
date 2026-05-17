import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "./analysis";
import type { TrackAnalysis, TrackMeta } from "./types";

type ExpectedSummary = {
  track?: TrackMeta;
  beat_starts: number[];
  beat_durations: number[];
  beat_confidences: Array<number | null>;
  beat_prev: Array<number | null>;
  beat_next: Array<number | null>;
  beat_parents: Array<number | null>;
  beat_index_in_parent: Array<number | null>;
  bar_children: number[][];
  beat_oseg: Array<number | null>;
  beat_overlaps: number[][];
};

type ValidCase = {
  id: string;
  input: unknown;
  expected: ExpectedSummary;
};

type InvalidCase = {
  id: string;
  input: unknown;
  expected_error: string;
};

type FixtureDoc = {
  schema_version: number;
  valid_cases: ValidCase[];
  invalid_cases: InvalidCase[];
};

function loadFixture(): FixtureDoc {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    currentDir,
    "../../../../../test-fixtures/engine-parity/analysis-normalization-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

function summarize(analysis: TrackAnalysis): ExpectedSummary {
  return {
    track: analysis.track,
    beat_starts: analysis.beats.map((beat) => beat.start),
    beat_durations: analysis.beats.map((beat) => beat.duration),
    beat_confidences: analysis.beats.map((beat) => beat.confidence ?? null),
    beat_prev: analysis.beats.map((beat) => beat.prev?.which ?? null),
    beat_next: analysis.beats.map((beat) => beat.next?.which ?? null),
    beat_parents: analysis.beats.map((beat) => beat.parent?.which ?? null),
    beat_index_in_parent: analysis.beats.map(
      (beat) => beat.indexInParent ?? null,
    ),
    bar_children: analysis.bars.map((bar) =>
      (bar.children ?? []).map((child) => child.which),
    ),
    beat_oseg: analysis.beats.map((beat) => beat.oseg?.which ?? null),
    beat_overlaps: analysis.beats.map((beat) =>
      beat.overlappingSegments.map((segment) => segment.which),
    ),
  };
}

describe("PWA analysis normalization parity fixtures", () => {
  it("matches shared valid normalization cases", () => {
    const fixture = loadFixture();

    for (const testCase of fixture.valid_cases) {
      expect(
        summarize(normalizeAnalysis(testCase.input)),
        testCase.id,
      ).toEqual(testCase.expected);
    }
  });

  it("matches shared invalid normalization cases", () => {
    const fixture = loadFixture();

    for (const testCase of fixture.invalid_cases) {
      expect(() => normalizeAnalysis(testCase.input), testCase.id).toThrow(
        testCase.expected_error,
      );
    }
  });
});
