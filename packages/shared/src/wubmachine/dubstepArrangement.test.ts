import { describe, expect, it } from "vitest";
import type { Segment } from "../engine/types";
import {
  estimateTonic,
  mixFactor,
  planDubstepRemix,
  type DubstepAnalysis,
} from "./dubstepArrangement";

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
function makeAnalysis(pitchAt: (beat: number) => number): DubstepAnalysis {
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

describe("estimateTonic", () => {
  it("finds the tonic of a major scale weighted toward its triad", () => {
    const weights = [0, 4, 7, 0, 4, 7, 0, 2, 5, 9, 11];
    const segments = weights.map((degree, i) => segment(i, (degree + 2) % 12));
    expect(estimateTonic(segments)).toBe(2);
  });
});

describe("mixFactor", () => {
  it("follows the loudness of the spanned segments and clamps", () => {
    const analysis = makeAnalysis(() => 0);
    const slices = [analysis.beats[0]!, analysis.beats[3]!];
    expect(mixFactor(analysis, slices)).toBeCloseTo(
      (-10 + 89 / 1.5 + 18) / (-10 + 188 / 1.5 + 18),
    );
    analysis.segments.forEach((s) => (s.loudness_max = -77));
    expect(mixFactor(analysis, slices)).toBe(0.3);
  });
});

describe("planDubstepRemix", () => {
  // Tonic C on beats 0, 4, 8, ...; D# and A once per bar; G elsewhere.
  const analysis = makeAnalysis((beat) => [0, 3, 9, 7][beat % 4]!);
  const plan = planDubstepRemix(analysis);

  it("builds an intro, two parts per section and an ending", () => {
    expect(plan.parts.map((part) => part.label)).toEqual([
      "intro",
      "section 1 drop",
      "section 1 break",
      "section 2 drop",
      "section 2 break",
      "ending",
    ]);
    expect(plan.timeRatio).toBeCloseTo(120 / 140);
  });

  it("stutters the intro over 32 beats", () => {
    const intro = plan.parts[0]!;
    expect(intro.samples).toEqual(["intro-eight"]);
    expect(intro.slices).toHaveLength(48);
    const total = intro.slices.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(32 * 0.5);
    expect(intro.slices[16]).toBe(analysis.beats[0]);
    expect(intro.slices[24]).toEqual({ start: 4, duration: 0.25 });
    expect(intro.slices[40]).toEqual({ start: 7, duration: 0.125 });
  });

  it("picks section beats by segment pitch: tonic, +3, +9", () => {
    const drop = plan.parts[3]!;
    expect(plan.tonic).toBe(0);
    expect(drop.slices).toHaveLength(32);
    expect(plan.parts[4]!.slices).toBe(drop.slices);
    // A segment ends in the beat after the one it starts in.
    const pitchOf = (start: number) => [0, 3, 9, 7][(start / 0.5 - 1) % 4];
    const pitches = drop.slices.slice(0, 16).map((s) => pitchOf(s.start));
    expect(pitches).toEqual([...Array(8).fill(0), 3, 3, 3, 3, 9, 9, 9, 9]);
    expect(drop.slices.every((s) => s.start >= 16)).toBe(true);
    expect(drop.slices.slice(16)).toEqual(drop.slices.slice(0, 16));
  });

  it("names samples by key, section index and section count", () => {
    expect(plan.parts[1]!.samples).toEqual([
      "wubs/c",
      "splashes/splash_04",
    ]);
    expect(plan.parts[2]!.samples).toEqual(["break-ends/c", "hats"]);
    expect(plan.parts[3]!.samples[1]).toBe("splashes/splash_02");
    expect(plan.parts[5]).toEqual({
      kind: "ending",
      label: "ending",
      samples: ["splash-ends/3"],
      slices: [],
      mix: 1,
    });
  });

  it("falls back to other pitches when a section lacks the tonic", () => {
    const sparse = makeAnalysis((beat) => (beat < 32 ? 7 : 0));
    const sparsePlan = planDubstepRemix(sparse);
    expect(sparsePlan.parts[1]!.slices).toHaveLength(32);
    expect(sparsePlan.parts[1]!.slices.every((s) => s.start < 16.5)).toBe(true);
  });
});
