import type { Segment, TrackMeta } from "../engine/types";

// Dubstep arrangement of the Wub Machine (psobot/wub-machine, MIT): an intro
// built from the first 16 beats, then two 8-bar parts per section, then a tail.

export const DUBSTEP_TEMPO = 140;
export const DUBSTEP_PART_BEATS = 32;

const MIXPOINT = 18;
const MIX_A = 89 / 1.5 + MIXPOINT;
const MIX_B = 188 / 1.5 + MIXPOINT;
const MIN_MIX = 0.3;
const MAX_MIX = 0.8;

const KEY_FILES = [
  "c",
  "c-sharp",
  "d",
  "d-sharp",
  "e",
  "f",
  "f-sharp",
  "g",
  "g-sharp",
  "a",
  "a-sharp",
  "b",
];
const SPLASH_ORDER = [3, 4, 2, 1, 5, 7, 6, 8, 10, 9, 11];
const SPLASH_END_COUNT = 4;

function splashName(index: number) {
  return `splashes/splash_${String(index).padStart(2, "0")}`;
}

// Every sample a plan can name.
export const DUBSTEP_SAMPLE_NAMES = [
  "intro-eight",
  "hats",
  ...KEY_FILES.flatMap((key) => [`wubs/${key}`, `break-ends/${key}`]),
  ...SPLASH_ORDER.map(splashName),
  ...Array.from(
    { length: SPLASH_END_COUNT },
    (_, index) => `splash-ends/${index + 1}`,
  ),
];

// Krumhansl-Kessler key profiles, indexed by semitones above the tonic.
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export type Quantum = { start: number; duration: number };

// A stretch of source audio and the number of remix beats it fills.
export type SourceSlice = Quantum & { beats: number };

export type DubstepAnalysis = {
  sections: Quantum[];
  bars?: Quantum[];
  beats: Quantum[];
  segments: Segment[];
  track?: TrackMeta;
};

export type DubstepPartKind = "intro" | "drop" | "break" | "ending";

export type DubstepPart = {
  kind: DubstepPartKind;
  label: string;
  // Sample names relative to the dubstep sample root, averaged into one bed.
  samples: string[];
  // Source audio laid end to end under the bed; parts may share one array.
  slices: SourceSlice[];
  // Bed gain; the source gets 1 - mix.
  mix: number;
};

export type DubstepPlan = {
  tonic: number;
  sourceTempo: number;
  // Stretched over unstretched source length; null fits each part to 8 bars.
  timeRatio: number | null;
  parts: DubstepPart[];
};

function end(quantum: Quantum) {
  return quantum.start + quantum.duration;
}

function correlation(a: number[], b: number[]) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let cross = 0;
  let powerA = 0;
  let powerB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = (a[i] as number) - meanA;
    const db = (b[i] as number) - meanB;
    cross += da * db;
    powerA += da * da;
    powerB += db * db;
  }
  return powerA > 0 && powerB > 0 ? cross / Math.sqrt(powerA * powerB) : 0;
}

// Pitch class (0 = C) of the best-correlated major or minor key.
export function estimateTonic(segments: Segment[]): number {
  const chroma = new Array<number>(12).fill(0);
  for (const segment of segments) {
    for (let pitch = 0; pitch < 12; pitch += 1) {
      chroma[pitch] =
        (chroma[pitch] as number) +
        (segment.pitches[pitch] ?? 0) * segment.duration;
    }
  }
  let best = 0;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12] as number);
    const score = Math.max(
      correlation(rotated, MAJOR_PROFILE),
      correlation(rotated, MINOR_PROFILE),
    );
    if (score > bestScore) {
      bestScore = score;
      best = tonic;
    }
  }
  return best;
}

function hasPitchMax(segment: Segment, pitch: number) {
  const value = segment.pitches[pitch] ?? 0;
  return segment.pitches.every((other) => value >= other);
}

function beatsInSection(analysis: DubstepAnalysis, section: Quantum) {
  return analysis.beats.filter(
    (beat) => beat.start >= section.start && beat.start < end(section),
  );
}

// Beats of the section that contain the end of a segment whose strongest
// pitch is `pitch` and which spans the start of a beat of the section.
function getSamples(
  analysis: DubstepAnalysis,
  section: Quantum,
  pitch: number,
): Quantum[] {
  const beats = beatsInSection(analysis, section);
  const segmentEnds = analysis.segments
    .filter(
      (segment) =>
        hasPitchMax(segment, pitch) &&
        beats.some(
          (beat) => segment.start <= beat.start && end(segment) >= beat.start,
        ),
    )
    .map(end);
  return beats.filter((beat) =>
    segmentEnds.some(
      (segmentEnd) => beat.start <= segmentEnd && end(beat) >= segmentEnd,
    ),
  );
}

// Walks up in fifths within the section, then in whole tones through the
// following sections, until some beats match.
function searchSamples(
  analysis: DubstepAnalysis,
  sectionIndex: number,
  pitch: number,
): Quantum[] {
  const { sections } = analysis;
  let j = sectionIndex;
  let key = pitch;
  let found = getSamples(analysis, sections[j] as Quantum, key);
  for (let tries = 0; tries < 5; tries += 1) {
    if (found.length > 0) {
      return found;
    }
    key = (key + 7) % 12;
    found = getSamples(analysis, sections[j] as Quantum, key);
  }
  for (let tries = 0; tries < 5; tries += 1) {
    if (found.length > 0) {
      break;
    }
    j = (j + 1) % sections.length;
    key = (key + 2) % 12;
    found = getSamples(analysis, sections[j] as Quantum, key);
  }
  return found;
}

function trackLoudness(segments: Segment[]) {
  if (segments.length === 0) {
    return 0;
  }
  return (
    segments.reduce((sum, segment) => sum + segment.loudness_max, 0) /
    segments.length
  );
}

// Bed gain from the mean peak loudness (dB) of the segments the slices span.
export function mixFactor(analysis: DubstepAnalysis, slices: Quantum[]) {
  const rangeStart = (slices[0] as Quantum).start;
  const rangeEnd = end(slices[slices.length - 1] as Quantum);
  const spanned = analysis.segments.filter(
    (segment) => end(segment) > rangeStart && segment.start < rangeEnd,
  );
  const loud = trackLoudness(spanned) || trackLoudness(analysis.segments);
  const mix = loud === -MIX_B ? 0 : (loud + MIX_A) / (loud + MIX_B);
  return Math.max(MIN_MIX, Math.min(MAX_MIX, mix));
}

function wholeBeat(beat: Quantum): SourceSlice {
  return { start: beat.start, duration: beat.duration, beats: 1 };
}

function introSlices(analysis: DubstepAnalysis, duration: number) {
  let beats = analysis.beats.slice(0, 16).map(wholeBeat);
  if (beats.length < 16) {
    const length = duration / 16;
    beats = Array.from({ length: 16 }, (_, i) => ({
      start: i * length,
      duration: length,
      beats: 1,
    }));
  }
  const at = (index: number) => beats[index] as SourceSlice;
  const cut = (beat: SourceSlice, divisor: number): SourceSlice => ({
    start: beat.start,
    duration: beat.duration / divisor,
    beats: 1 / divisor,
  });
  const repeat = (slice: SourceSlice, count: number) =>
    Array.from({ length: count }, () => slice);
  return [
    ...beats,
    ...repeat(at(0), 4),
    ...repeat(at(4), 4),
    ...repeat(cut(at(8), 2), 8),
    ...repeat(cut(at(12), 4), 8),
    ...repeat(cut(at(14), 4), 8),
  ];
}

const PHRASE_BEATS = 16;
const PHRASE_SLOTS = [8, 4, 4];

type Pools = [Quantum[], Quantum[], Quantum[]];

// Start of the unused 16-beat window that best follows the pool order
// (8 tonic beats, 4 a minor third up, 4 a major sixth up); ties go to a window
// starting on a bar line, then to the earliest. Null once no window is free.
function bestWindow(
  beats: Quantum[],
  pools: Pools,
  barStarts: Set<number>,
  used: Set<Quantum>,
): number | null {
  const members = pools.map((pool) => new Set(pool));
  let best: number | null = null;
  let bestScore = -1;
  for (let start = 0; start + PHRASE_BEATS <= beats.length; start += 1) {
    const window = beats.slice(start, start + PHRASE_BEATS);
    if (window.some((beat) => used.has(beat))) {
      continue;
    }
    let score = barStarts.has((window[0] as Quantum).start) ? 0.5 : 0;
    let slot = 0;
    let slotEnd = PHRASE_SLOTS[0] as number;
    window.forEach((beat, i) => {
      if (i >= slotEnd) {
        slot += 1;
        slotEnd += PHRASE_SLOTS[slot] as number;
      }
      if (members[slot]?.has(beat)) {
        score += 1;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return best;
}

function cycle(beats: Quantum[], count: number) {
  return Array.from(
    { length: count },
    (_, i) => beats[i % beats.length] as Quantum,
  );
}

// Up to `count` non-overlapping phrases of the section, chosen by pool fit
// and played in song order. A section shorter than a phrase cycles its beats.
function contiguousPhrases(
  analysis: DubstepAnalysis,
  section: Quantum,
  pools: Pools,
  count: number,
): Quantum[][] {
  const beats = beatsInSection(analysis, section);
  const barStarts = new Set((analysis.bars ?? []).map((bar) => bar.start));
  const used = new Set<Quantum>();
  const starts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = bestWindow(beats, pools, barStarts, used);
    if (start === null) {
      break;
    }
    starts.push(start);
    beats.slice(start, start + PHRASE_BEATS).forEach((beat) => used.add(beat));
  }
  if (starts.length === 0) {
    return [cycle(beats, PHRASE_BEATS)];
  }
  return starts
    .sort((a, b) => a - b)
    .map((start) => beats.slice(start, start + PHRASE_BEATS));
}

// Beat pools for the section: tonic, +3 and +9, each falling back to the
// fullest pool, then to any pitch, then to every beat of the section.
function sectionPools(
  analysis: DubstepAnalysis,
  sectionIndex: number,
  tonic: number,
): Pools | null {
  const find = (pitch: number) => searchSamples(analysis, sectionIndex, pitch);
  const [s1, s2, s3] = [
    find(tonic),
    find((tonic + 3) % 12),
    find((tonic + 9) % 12),
  ];
  let biggest = [s1, s2, s3].reduce((a, b) => (b.length > a.length ? b : a));
  for (let i = 0; i < 12 && biggest.length === 0; i += 1) {
    biggest = find((tonic + i) % 12);
  }
  if (biggest.length === 0) {
    biggest = beatsInSection(
      analysis,
      analysis.sections[sectionIndex] as Quantum,
    );
  }
  if (biggest.length === 0) {
    return null;
  }
  return [
    s1.length > 0 ? s1 : biggest,
    s2.length > 0 ? s2 : biggest,
    s3.length > 0 ? s3 : biggest,
  ];
}

// Source beats for each of the section's `partCount` parts, 32 per part.
// The original cycles through each pool in order and repeats one 16-beat
// bar everywhere; `contiguous` instead walks the section phrase by phrase.
function sectionParts(
  analysis: DubstepAnalysis,
  sectionIndex: number,
  tonic: number,
  partCount: number,
  contiguous: boolean,
): SourceSlice[][] | null {
  const pools = sectionPools(analysis, sectionIndex, tonic);
  if (!pools) {
    return null;
  }
  if (!contiguous) {
    const bar: Quantum[] = [];
    for (let i = 0; i < PHRASE_BEATS; i += 1) {
      const pool = i < 8 ? pools[0] : i < 12 ? pools[1] : pools[2];
      bar.push(pool[i % pool.length] as Quantum);
    }
    const slices = [...bar, ...bar].map(wholeBeat);
    return Array.from({ length: partCount }, () => slices);
  }
  const phrases = contiguousPhrases(
    analysis,
    analysis.sections[sectionIndex] as Quantum,
    pools,
    partCount * 2,
  );
  return Array.from({ length: partCount }, (_, part) =>
    [
      ...(phrases[(part * 2) % phrases.length] as Quantum[]),
      ...(phrases[(part * 2 + 1) % phrases.length] as Quantum[]),
    ].map(wholeBeat),
  );
}

// Parts a section earns by length: under 12 bars a drop alone, under 24 bars
// a drop and a break, longer sections two of each.
function sectionPartCount(beatCount: number) {
  if (beatCount < 48) {
    return 1;
  }
  return beatCount < 96 ? 2 : 4;
}

const MIN_SECTION_BEATS = 16;
const QUIET_SECTION_DB = 15;

// Folds sections shorter than four bars into the section after them (the
// last one into the section before it).
function mergeShortSections(analysis: DubstepAnalysis): Quantum[] {
  const merged: Quantum[] = [];
  let pending: Quantum | null = null;
  for (const section of analysis.sections) {
    const combined: Quantum = pending
      ? { start: pending.start, duration: end(section) - pending.start }
      : section;
    if (beatsInSection(analysis, combined).length < MIN_SECTION_BEATS) {
      pending = combined;
      continue;
    }
    merged.push(combined);
    pending = null;
  }
  if (pending) {
    const last = merged.pop();
    merged.push(
      last
        ? { start: last.start, duration: end(pending) - last.start }
        : pending,
    );
  }
  return merged;
}

// Drops sections whose peak loudness sits well under the track's.
function dropQuietSections(analysis: DubstepAnalysis): Quantum[] {
  const reference = trackLoudness(analysis.segments);
  return analysis.sections.filter((section) => {
    const spanned = analysis.segments.filter(
      (segment) => end(segment) > section.start && segment.start < end(section),
    );
    return (
      spanned.length > 0 &&
      trackLoudness(spanned) >= reference - QUIET_SECTION_DB
    );
  });
}

export type DubstepPlanOptions = {
  // Play runs of consecutive beats instead of cycling through scattered ones.
  contiguous?: boolean;
  // Pitch class (0 = C) to remix in; estimated from the track when omitted.
  tonic?: number;
  // Size each section's share of the remix by its length instead of a fixed
  // drop and break, folding very short sections into their neighbours.
  sectionBudget?: boolean;
  // Leave out sections far quieter than the track.
  skipQuiet?: boolean;
  // Push the samples forward in drops and the song forward in breaks.
  contrast?: boolean;
  // Stutter the last two beats before each drop.
  fills?: boolean;
};

const MIX_TILT = 0.15;

function clampMix(mix: number) {
  return Math.max(MIN_MIX, Math.min(MAX_MIX, mix));
}

// Replaces the last two beats with a ramping stutter: the second-last beat
// as two halves, the last as four quarters.
function withFill(slices: SourceSlice[]): SourceSlice[] {
  if (slices.length < 2) {
    return slices;
  }
  const [half, quarter] = slices.slice(-2) as [SourceSlice, SourceSlice];
  const cut = (slice: SourceSlice, divisor: number): SourceSlice => ({
    start: slice.start,
    duration: slice.duration / divisor,
    beats: slice.beats / divisor,
  });
  return [
    ...slices.slice(0, -2),
    cut(half, 2),
    cut(half, 2),
    ...Array.from({ length: 4 }, () => cut(quarter, 4)),
  ];
}

export function planDubstepRemix(
  input: DubstepAnalysis,
  options: DubstepPlanOptions = {},
): DubstepPlan {
  let analysis = input;
  if (options.sectionBudget) {
    analysis = { ...analysis, sections: mergeShortSections(analysis) };
  }
  if (options.skipQuiet) {
    analysis = { ...analysis, sections: dropQuietSections(analysis) };
  }
  const { sections, beats, segments, track } = analysis;
  const lastSegment = segments[segments.length - 1];
  const duration = track?.duration ?? (lastSegment ? end(lastSegment) : 0);
  const estimatedTempo =
    beats.length < 16 || !track?.tempo ? (60 * 16) / duration : track.tempo;
  // Without a usable tempo the source plays unstretched.
  const sourceTempo =
    Number.isFinite(estimatedTempo) && estimatedTempo > 0
      ? estimatedTempo
      : DUBSTEP_TEMPO;
  const tonic = options.tonic ?? estimateTonic(segments);
  const key = KEY_FILES[tonic] as string;

  const intro = introSlices(analysis, duration);
  const parts: DubstepPart[] = [
    {
      kind: "intro",
      label: "intro",
      samples: ["intro-eight"],
      slices: intro,
      mix: mixFactor(analysis, intro),
    },
  ];
  let consecutiveDrops = 0;
  sections.forEach((section, j) => {
    const partCount = options.sectionBudget
      ? sectionPartCount(beatsInSection(analysis, section).length)
      : 2;
    const sectionSlices = sectionParts(
      analysis,
      j,
      tonic,
      partCount,
      options.contiguous ?? false,
    );
    if (!sectionSlices) {
      return;
    }
    const splash = SPLASH_ORDER[(j + 1) % SPLASH_ORDER.length] as number;
    sectionSlices.forEach((slices, p) => {
      // Drops and breaks alternate within a section; drop-only sections
      // never stack more than two drops in a row.
      const drop = p % 2 === 0 && consecutiveDrops < 2;
      consecutiveDrops = drop ? consecutiveDrops + 1 : 0;
      const mix = mixFactor(analysis, slices);
      if (drop) {
        parts.push({
          kind: "drop",
          label: `section ${j + 1} drop`,
          samples: [`wubs/${key}`, splashName(splash)],
          slices,
          mix: options.contrast ? clampMix(mix + MIX_TILT) : mix,
        });
        return;
      }
      parts.push({
        kind: "break",
        label: `section ${j + 1} break`,
        samples: [`break-ends/${key}`, "hats"],
        slices,
        mix: options.contrast ? clampMix(mix - MIX_TILT) : mix,
      });
    });
  });
  if (options.fills) {
    parts.forEach((part, i) => {
      const next = parts[i + 1];
      if (part.kind !== "intro" && next?.kind === "drop") {
        part.slices = withFill(part.slices);
      }
    });
  }
  parts.push({
    kind: "ending",
    label: "ending",
    samples: [
      `splash-ends/${(Math.max(sections.length, 1) % SPLASH_END_COUNT) + 1}`,
    ],
    slices: [],
    mix: 1,
  });

  return {
    tonic,
    sourceTempo,
    timeRatio:
      (track?.time_signature ?? 4) === 4 ? sourceTempo / DUBSTEP_TEMPO : null,
    parts,
  };
}
