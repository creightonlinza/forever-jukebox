// Regenerates test-fixtures/engine-parity/wub-arrangement-cases.json from the
// shared arrangement. Run from packages/shared after an intentional change to
// dubstepArrangement.ts:
//   npx vite-node scripts/generate-wub-arrangement-fixture.ts
//   npm run fixtures:manifest
// then sync the android repo (scripts/sync-parity-fixtures.sh there).
import fs from "node:fs";
import path from "node:path";
import type { Segment } from "../src/engine/types";
import {
  planDubstepRemix,
  type DubstepPlanOptions,
} from "../src/wubmachine/dubstepArrangement";
import {
  FIXTURE_DIR,
  WUB_ARRANGEMENT_FIXTURE,
  analysisOfCase,
  planToFixture,
  type FixtureAnalysis,
  type FixtureCase,
  type FixtureDoc,
} from "./wubArrangementFixture";

// Plan options of WUB_MACHINE_ARRANGEMENT (wubMachineRender.ts), spelled out so
// this script does not load the browser-only render module.
const HOUSE_OPTIONS: DubstepPlanOptions = {
  contiguous: true,
  sectionBudget: true,
  skipQuiet: true,
  balance: true,
  fills: true,
};

function segment(start: number, pitch: number, loudness = -10): Segment {
  const pitches = new Array<number>(12).fill(0.1);
  pitches[pitch] = 1;
  return {
    start,
    duration: 0.5,
    confidence: 1,
    loudness_start: -60,
    loudness_max: loudness,
    loudness_max_time: 0,
    pitches,
    timbre: new Array<number>(12).fill(0),
    which: 0,
  };
}

// 64 half-second beats in two sections; one segment per beat, starting a
// quarter beat late so each segment ends inside the following beat.
function makeAnalysis(pitchAt: (beat: number) => number): FixtureAnalysis {
  const beats = Array.from({ length: 64 }, (_, i) => ({
    start: i * 0.5,
    duration: 0.5,
  }));
  return {
    sections: [
      { start: 0, duration: 16 },
      { start: 16, duration: 16 },
    ],
    beats,
    segments: beats.map((beat, i) => segment(beat.start + 0.125, pitchAt(i))),
    track: { duration: 32, tempo: 120, time_signature: 4 },
  };
}

function makeLongAnalysis(beatCount: number): FixtureAnalysis {
  const beats = Array.from({ length: beatCount }, (_, i) => ({
    start: i * 0.5,
    duration: 0.5,
  }));
  return {
    sections: [{ start: 0, duration: beatCount * 0.5 }],
    beats,
    segments: beats.map((beat) => segment(beat.start + 0.125, 0)),
    track: { duration: beatCount * 0.5, tempo: 120, time_signature: 4 },
  };
}

function withSections(
  analysis: FixtureAnalysis,
  beatCounts: number[],
): FixtureAnalysis {
  let start = 0;
  const sections = beatCounts.map((count) => {
    const section = { start, duration: count * 0.5 };
    start += count * 0.5;
    return section;
  });
  return { ...analysis, sections };
}

const triad = makeAnalysis((beat) => [0, 3, 10, 7][beat % 4] as number);
const bars = Array.from({ length: 16 }, (_, i) => ({ start: i * 2, duration: 2 }));
const quiet = makeAnalysis(() => 0);
quiet.segments = quiet.segments.map((s) =>
  s.start >= 16 ? { ...s, loudness_max: -50 } : s,
);

// Two 24-beat sections either side of a quiet 32-beat one.
const quietBarrier = withSections(makeLongAnalysis(80), [24, 32, 24]);
quietBarrier.segments = quietBarrier.segments.map((s) =>
  s.start >= 12 && s.start < 28 ? { ...s, loudness_max: -80 } : s,
);
// 8 beats with no neighbour, a quiet 32-beat section, then 40 beats.
const strandedShort = withSections(makeLongAnalysis(80), [8, 32, 40]);
strandedShort.segments = strandedShort.segments.map((s) =>
  s.start >= 4 && s.start < 20 ? { ...s, loudness_max: -80 } : s,
);

type CaseInput = Omit<FixtureCase, "expected">;

const inputs: CaseInput[] = [
  { id: "triad_default", analysis: triad },
  { id: "triad_house", analysis: { ...triad, bars }, options: HOUSE_OPTIONS },
  { id: "triad_contiguous_bars", analysis: { ...triad, bars }, options: { contiguous: true } },
  { id: "triad_balance", analysis: triad, options: { balance: true } },
  { id: "quiet_balance", analysis: quiet, options: { balance: true } },
  { id: "triad_fills", analysis: triad, options: { fills: true } },
  {
    id: "sparse_window",
    analysis: makeAnalysis((beat) => (beat >= 43 && beat < 51 ? 0 : 7)),
    options: { contiguous: true, tonic: 0 },
  },
  {
    id: "section_budget_merges_to_target",
    analysis: withSections(makeLongAnalysis(480), new Array<number>(12).fill(40)),
    options: { sectionBudget: true, contiguous: true, tonic: 0 },
  },
  {
    id: "section_budget_tiers",
    analysis: withSections(makeLongAnalysis(260), [8, 32, 220]),
    options: { sectionBudget: true, tonic: 0 },
  },
  {
    id: "section_budget_drop_cap",
    analysis: withSections(makeLongAnalysis(96), [32, 32, 32]),
    options: { sectionBudget: true, tonic: 0 },
  },
  {
    id: "section_budget_quiet_barrier",
    analysis: quietBarrier,
    options: { sectionBudget: true, skipQuiet: true, contiguous: true, tonic: 0 },
  },
  {
    id: "section_budget_stranded_short",
    analysis: strandedShort,
    options: { sectionBudget: true, skipQuiet: true, contiguous: true, tonic: 0 },
  },
  { id: "bare", analysis: { sections: [], beats: [], segments: [] } },
  {
    id: "too_few_beats",
    analysis: {
      sections: [{ start: 0, duration: 32 }],
      beats: [{ start: 0, duration: 1 }],
      segments: [],
      track: { duration: 32, tempo: 100 },
    },
  },
  { id: "skip_quiet", analysis: quiet, options: { skipQuiet: true } },
  {
    id: "tonic_fallback",
    analysis: makeAnalysis((beat) => (beat < 32 ? 7 : 0)),
  },
  {
    id: "beatless_section",
    analysis: {
      ...makeAnalysis(() => 0),
      sections: [
        { start: 0.1, duration: 0.25 },
        { start: 0.35, duration: 31.65 },
      ],
    },
    options: { contiguous: true, tonic: 0 },
  },
  { id: "real_default", analysis_ref: "real-analysis-cases.json" },
  { id: "real_house", analysis_ref: "real-analysis-cases.json", options: HOUSE_OPTIONS },
];

const doc: FixtureDoc = {
  schema_version: 1,
  cases: inputs.map((input) => ({
    ...input,
    expected: planToFixture(
      planDubstepRemix(analysisOfCase(input), input.options ?? {}),
    ),
  })),
};

const target = path.join(FIXTURE_DIR, WUB_ARRANGEMENT_FIXTURE);
fs.writeFileSync(target, `${JSON.stringify(doc)}\n`);
console.log(`wrote ${doc.cases.length} cases to ${target}`);
console.log("Next: npm run fixtures:manifest");
