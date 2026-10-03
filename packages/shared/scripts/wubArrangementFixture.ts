// Shape of test-fixtures/engine-parity/wub-arrangement-cases.json, shared by
// the generator script and the parity test that replays it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAnalysis } from "../src/engine/analysis";
import type { Segment, TrackMeta } from "../src/engine/types";
import type {
  DubstepAnalysis,
  DubstepPlan,
  DubstepPlanOptions,
  Quantum,
} from "../src/wubmachine/dubstepArrangement";

export const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test-fixtures/engine-parity",
);
export const WUB_ARRANGEMENT_FIXTURE = "wub-arrangement-cases.json";

export type FixtureAnalysis = {
  sections: Quantum[];
  bars?: Quantum[];
  beats: Quantum[];
  segments: Segment[];
  track?: TrackMeta;
};

export type FixturePlan = {
  tonic: number;
  parts: Array<{
    kind: string;
    label: string;
    samples: string[];
    // [start, duration, beats]
    slices: Array<[number, number, number]>;
    mix: number;
  }>;
};

export type FixtureCase = {
  id: string;
  // Inline analysis, or the name of a sibling fixture whose `analysis` to parse.
  analysis?: FixtureAnalysis;
  analysis_ref?: string;
  options?: DubstepPlanOptions;
  expected: FixturePlan;
};

export type FixtureDoc = {
  schema_version: number;
  cases: FixtureCase[];
};

export function planToFixture(plan: DubstepPlan): FixturePlan {
  return {
    tonic: plan.tonic,
    parts: plan.parts.map((part) => ({
      kind: part.kind,
      label: part.label,
      samples: part.samples,
      slices: part.slices.map(
        (slice) => [slice.start, slice.duration, slice.beats] as [number, number, number],
      ),
      mix: part.mix,
    })),
  };
}

export function readFixtureJson<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"),
  ) as T;
}

export function analysisOfCase(
  testCase: Pick<FixtureCase, "analysis" | "analysis_ref">,
): DubstepAnalysis {
  if (testCase.analysis_ref) {
    const source = readFixtureJson<{ analysis: unknown }>(testCase.analysis_ref);
    return parseAnalysis(source.analysis);
  }
  if (!testCase.analysis) {
    throw new Error("fixture case needs analysis or analysis_ref");
  }
  return testCase.analysis;
}
