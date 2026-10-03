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

function makeLongAnalysis(beatCount: number): DubstepAnalysis {
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
  analysis: DubstepAnalysis,
  beatCounts: number[],
): DubstepAnalysis {
  let start = 0;
  const sections = beatCounts.map((count) => {
    const section = { start, duration: count * 0.5 };
    start += count * 0.5;
    return section;
  });
  return { ...analysis, sections };
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
  });

  it("stutters the intro over 32 beats", () => {
    const intro = plan.parts[0]!;
    expect(intro.samples).toEqual(["intro-eight"]);
    expect(intro.slices).toHaveLength(48);
    const total = intro.slices.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(32 * 0.5);
    expect(intro.slices[16]).toEqual({ start: 0, duration: 0.5, beats: 1 });
    expect(intro.slices[24]).toEqual({ start: 4, duration: 0.25, beats: 0.5 });
    expect(intro.slices[40]).toEqual({ start: 7, duration: 0.125, beats: 0.25 });
    expect(intro.slices.reduce((sum, s) => sum + s.beats, 0)).toBe(32);
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

  it("walks the section in 16-beat phrases when contiguous", () => {
    const bars = Array.from({ length: 16 }, (_, i) => ({
      start: i * 2,
      duration: 2,
    }));
    const plan = planDubstepRemix({ ...analysis, bars }, { contiguous: true });
    const drop = plan.parts[3]!;
    const starts = drop.slices.map((s) => s.start / 0.5);
    // Section 2 holds exactly two phrases; the drop plays them in order and
    // the break, with no phrases left, plays the same two again.
    expect(starts).toEqual(Array.from({ length: 32 }, (_, i) => 32 + i));
    expect(plan.parts[4]!.slices).toEqual(drop.slices);
    expect(drop.slices.every((s) => s.beats === 1)).toBe(true);
  });

  it("favours the window with the most matching beats", () => {
    // Tonic only on beats 44..51 of section 2; everything else is G.
    const sparse = makeAnalysis((beat) =>
      beat >= 43 && beat < 51 ? 0 : 7,
    );
    const starts = planDubstepRemix(sparse, { contiguous: true, tonic: 0 })
      .parts[3]!.slices.slice(0, 16)
      .map((s) => s.start / 0.5);
    expect(starts).toContain(44);
    expect(starts).toContain(51);
    expect(starts).toEqual(
      Array.from({ length: 16 }, (_, i) => starts[0]! + i),
    );
  });

  it("sizes each section's share by its length", () => {
    // Sections of 8, 32 and 100 beats: the first folds into the second.
    const long = withSections(makeLongAnalysis(140), [8, 32, 100]);
    const plan = planDubstepRemix(long, { sectionBudget: true });
    expect(plan.parts.map((part) => part.label)).toEqual([
      "intro",
      "section 1 drop",
      "section 2 drop",
      "section 2 break",
      "section 2 drop",
      "section 2 break",
      "ending",
    ]);
    expect(plan.parts[1]!.slices.every((s) => s.start < 20)).toBe(true);
  });

  it("never stacks more than two drops in a row", () => {
    const long = withSections(makeLongAnalysis(160), [32, 32, 32, 32, 32]);
    const plan = planDubstepRemix(long, { sectionBudget: true });
    expect(plan.parts.map((part) => part.kind)).toEqual([
      "intro",
      "drop",
      "drop",
      "break",
      "drop",
      "drop",
      "ending",
    ]);
  });

  it("tilts the mix toward the samples in drops and the song in breaks", () => {
    const plain = planDubstepRemix(analysis);
    const contrast = planDubstepRemix(analysis, { contrast: true });
    expect(contrast.parts[1]!.mix).toBeCloseTo(plain.parts[1]!.mix + 0.15);
    expect(contrast.parts[2]!.mix).toBeCloseTo(plain.parts[2]!.mix - 0.15);
    expect(contrast.parts[2]!.samples).toEqual(plain.parts[2]!.samples);
  });

  it("stutters the last two beats before each drop", () => {
    const plan = planDubstepRemix(analysis, { fills: true });
    const before = plan.parts[2]!.slices;
    expect(before).toHaveLength(36);
    expect(before.slice(30).map((s) => s.beats)).toEqual([
      0.5, 0.5, 0.25, 0.25, 0.25, 0.25,
    ]);
    expect(before[30]!.start).toBe(before[31]!.start);
    expect(before.reduce((sum, s) => sum + s.beats, 0)).toBe(32);
    // The intro already stutters; the last break has no drop after it.
    expect(plan.parts[0]!.slices).toHaveLength(48);
    expect(plan.parts[4]!.slices).toHaveLength(32);
  });

  it("copes with tracks the analysis barely describes", () => {
    const bare = planDubstepRemix({ sections: [], beats: [], segments: [] });
    expect(bare.parts.map((part) => part.kind)).toEqual(["intro", "ending"]);
    expect(bare.parts[0]!.slices.every((s) => s.duration === 0)).toBe(true);

    // Too few beats: the intro is cut from 16 equal slices of the track.
    const short = planDubstepRemix({
      sections: [{ start: 0, duration: 32 }],
      beats: [{ start: 0, duration: 1 }],
      segments: [],
      track: { duration: 32, tempo: 100 },
    });
    expect(short.parts[0]!.slices[1]).toEqual({ start: 2, duration: 2, beats: 1 });
    // Beats exist but no segment matches: every section beat is used.
    expect(short.parts[1]!.slices.every((s) => s.start === 0)).toBe(true);
  });

  it("leaves out sections far quieter than the track", () => {
    const quiet = makeAnalysis(() => 0);
    quiet.segments.forEach((segment) => {
      if (segment.start >= 16) {
        segment.loudness_max = -50;
      }
    });
    const plan = planDubstepRemix(quiet, { skipQuiet: true });
    expect(plan.parts.map((part) => part.label)).toEqual([
      "intro",
      "section 1 drop",
      "section 1 break",
      "ending",
    ]);
  });

  it("falls back to other pitches when a section lacks the tonic", () => {
    const sparse = makeAnalysis((beat) => (beat < 32 ? 7 : 0));
    const sparsePlan = planDubstepRemix(sparse);
    expect(sparsePlan.parts[1]!.slices).toHaveLength(32);
    expect(sparsePlan.parts[1]!.slices.every((s) => s.start < 16.5)).toBe(true);
  });

  it("skips a section without beats even when later sections match", () => {
    const analysis = makeAnalysis(() => 0);
    analysis.sections = [
      { start: 0.1, duration: 0.25 },
      { start: 0.35, duration: 31.65 },
    ];
    const plan = planDubstepRemix(analysis, { contiguous: true, tonic: 0 });
    expect(plan.parts.map((part) => part.label)).toEqual([
      "intro",
      "section 2 drop",
      "section 2 break",
      "ending",
    ]);
  });
});
