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

// Sample name per pitch class; segment pitches start at A.
const KEY_FILES = [
  "a",
  "a-sharp",
  "b",
  "c",
  "c-sharp",
  "d",
  "d-sharp",
  "e",
  "f",
  "f-sharp",
  "g",
  "g-sharp",
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

// Semitones from a key's tonic up to the bass notes the wub samples play
// after it, and from a major key's tonic up to its relative minor's.
const MINOR_THIRD = 3;
const MINOR_SEVENTH = 10;
const RELATIVE_MINOR = 9;

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
  // Pitch class of the key, 0 = A.
  tonic: number;
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

// Pitch class (0 = A, as segment pitches) of the minor key to remix in: the
// best-correlated minor key, or the relative minor of a better major one.
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
    const minor = correlation(rotated, MINOR_PROFILE);
    if (minor > bestScore) {
      bestScore = minor;
      best = tonic;
    }
    const major = correlation(rotated, MAJOR_PROFILE);
    if (major > bestScore) {
      bestScore = major;
      best = (tonic + RELATIVE_MINOR) % 12;
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
  const denominator = loud + MIX_B;
  const mix = Math.abs(denominator) < 1e-9 ? 0 : (loud + MIX_A) / denominator;
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

// Pool index that beat `i` of a 16-beat phrase draws from.
function poolSlot(i: number): 0 | 1 | 2 {
  if (i < 8) {
    return 0;
  }
  return i < 12 ? 1 : 2;
}

type Pools = [Quantum[], Quantum[], Quantum[]];

// Start of the unused 16-beat window that best follows the pool order
// (8 tonic beats, 4 a minor third up, 4 a minor seventh up); ties go to a window
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
    window.forEach((beat, i) => {
      if (members[poolSlot(i)]?.has(beat)) {
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
// and played in song order. A section shorter than a phrase cycles its beats;
// one without beats yields null.
function contiguousPhrases(
  analysis: DubstepAnalysis,
  section: Quantum,
  pools: Pools,
  count: number,
): Quantum[][] | null {
  const beats = beatsInSection(analysis, section);
  if (beats.length === 0) {
    return null;
  }
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
  starts.sort((a, b) => a - b);
  return starts.map((start) => beats.slice(start, start + PHRASE_BEATS));
}

// Beat pools for the section, following the wub bass (tonic, minor third,
// minor seventh), each falling back to the
// fullest pool, then to any pitch, then to every beat of the section.
function sectionPools(
  analysis: DubstepAnalysis,
  sectionIndex: number,
  tonic: number,
): Pools | null {
  const find = (pitch: number) => searchSamples(analysis, sectionIndex, pitch);
  const [s1, s2, s3] = [
    find(tonic),
    find((tonic + MINOR_THIRD) % 12),
    find((tonic + MINOR_SEVENTH) % 12),
  ];
  let biggest = [s2, s3].reduce((a, b) => (b.length > a.length ? b : a), s1);
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
      const pool = pools[poolSlot(i)];
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
  if (!phrases) {
    return null;
  }
  return Array.from({ length: partCount }, (_, part) =>
    [
      ...(phrases[(part * 2) % phrases.length] as Quantum[]),
      ...(phrases[(part * 2 + 1) % phrases.length] as Quantum[]),
    ].map(wholeBeat),
  );
}

// Parts a section earns by length: under 12 bars a drop alone, under 48 bars
// a drop and a break, longer sections two of each.
function sectionPartCount(beatCount: number) {
  if (beatCount < 48) {
    return 1;
  }
  return beatCount < 192 ? 2 : 4;
}

const MIN_SECTION_BEATS = 16;
const MIN_SECTIONS = 3;
const MAX_SECTIONS = 5;
const BEATS_PER_SECTION = 128;
const QUIET_SECTION_DB = 15;

// Sections without segments or whose peak loudness sits well under the track's.
function quietSections(analysis: DubstepAnalysis): Set<Quantum> {
  const reference = trackLoudness(analysis.segments);
  return new Set(
    analysis.sections.filter((section) => {
      const spanned = analysis.segments.filter(
        (segment) =>
          end(segment) > section.start && segment.start < end(section),
      );
      return (
        spanned.length === 0 ||
        trackLoudness(spanned) < reference - QUIET_SECTION_DB
      );
    }),
  );
}

type SectionRun = Quantum & {
  beats: number;
  // A skipped section lies between this run and the one before it.
  gapBefore: boolean;
};

function joinsNext(runs: SectionRun[], i: number) {
  const next = runs[i + 1];
  return i >= 0 && next !== undefined && !next.gapBefore;
}

// Index of the shortest run that has a neighbour to merge with, or -1.
function shortestMergeable(runs: SectionRun[]) {
  let shortest = -1;
  runs.forEach((run, i) => {
    const mergeable = joinsNext(runs, i) || joinsNext(runs, i - 1);
    if (
      mergeable &&
      (shortest < 0 || run.beats < (runs[shortest] as SectionRun).beats)
    ) {
      shortest = i;
    }
  });
  return shortest;
}

// Merges run `i` with its shorter neighbour; a tie goes to the one after it.
function mergeWithNeighbour(runs: SectionRun[], i: number) {
  const before = joinsNext(runs, i - 1) ? runs[i - 1] : undefined;
  const after = joinsNext(runs, i) ? runs[i + 1] : undefined;
  const intoBefore = before && (!after || before.beats < after.beats);
  const first = intoBefore ? i - 1 : i;
  const a = runs[first] as SectionRun;
  const b = runs[first + 1] as SectionRun;
  runs.splice(first, 2, {
    start: a.start,
    duration: end(b) - a.start,
    beats: a.beats + b.beats,
    gapBefore: a.gapBefore,
  });
}

// Folds the shortest section into its shorter neighbour until three to five
// remain (one per 32 bars of song) and none is under four bars. Skipped
// sections are left out and never merged across.
function mergeSections(
  analysis: DubstepAnalysis,
  skipped: Set<Quantum>,
): Quantum[] {
  const runs: SectionRun[] = [];
  let gapBefore = false;
  for (const section of analysis.sections) {
    if (skipped.has(section)) {
      gapBefore = true;
      continue;
    }
    runs.push({
      start: section.start,
      duration: section.duration,
      beats: beatsInSection(analysis, section).length,
      gapBefore,
    });
    gapBefore = false;
  }
  const total = runs.reduce((sum, run) => sum + run.beats, 0);
  const target = Math.max(
    MIN_SECTIONS,
    Math.min(MAX_SECTIONS, Math.round(total / BEATS_PER_SECTION)),
  );
  let shortest = shortestMergeable(runs);
  while (
    shortest >= 0 &&
    (runs.length > target ||
      (runs[shortest] as SectionRun).beats < MIN_SECTION_BEATS)
  ) {
    mergeWithNeighbour(runs, shortest);
    shortest = shortestMergeable(runs);
  }
  return runs.map(({ start, duration }) => ({ start, duration }));
}

export type DubstepPlanOptions = {
  // Play runs of consecutive beats instead of cycling through scattered ones.
  contiguous?: boolean;
  // Pitch class (0 = A) to remix in; estimated from the track when omitted.
  tonic?: number;
  // Merge the song down to three to five sections and size each one's share
  // of the remix by its length instead of a fixed drop and break.
  sectionBudget?: boolean;
  // Leave out sections far quieter than the track.
  skipQuiet?: boolean;
  // Set each part's mix from the song's level there: level with the samples
  // in the intro and drops, forward of them in breaks.
  balance?: boolean;
  // Stutter the last two beats before each drop.
  fills?: boolean;
};

// Average level (dBFS) of each kind of part's sample bed.
const BED_LEVEL_DB = { intro: -7.1, drop: -12.9, break: -13.7 };
// How far (dB) the song sits above the bed in each kind of part.
const SONG_OVER_BED_DB = { intro: 0, drop: 0, break: 8 };
// Segment peak loudness runs this far above a passage's average level.
const LOUDNESS_OVER_LEVEL_DB = 4.3;

// Bed gain that puts the song at its target level against the bed, judged
// from the segments the slices overlap; the original's mix without any.
function balancedMix(
  analysis: DubstepAnalysis,
  kind: keyof typeof BED_LEVEL_DB,
  slices: Quantum[],
) {
  const heard = slices.flatMap((slice) =>
    analysis.segments.filter(
      (segment) => end(segment) > slice.start && segment.start < end(slice),
    ),
  );
  if (heard.length === 0) {
    return mixFactor(analysis, slices);
  }
  const songLevel = trackLoudness(heard) - LOUDNESS_OVER_LEVEL_DB;
  const gap = SONG_OVER_BED_DB[kind] + BED_LEVEL_DB[kind] - songLevel;
  const mix = 1 / (1 + 10 ** (gap / 20));
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
  const skipped = options.skipQuiet
    ? quietSections(input)
    : new Set<Quantum>();
  const analysis = {
    ...input,
    sections: options.sectionBudget
      ? mergeSections(input, skipped)
      : input.sections.filter((section) => !skipped.has(section)),
  };
  const { sections, segments, track } = analysis;
  const lastSegment = segments[segments.length - 1];
  const duration = track?.duration ?? (lastSegment ? end(lastSegment) : 0);
  const tonic = options.tonic ?? estimateTonic(segments);
  const key = KEY_FILES[tonic] as string;

  const mixOf = (kind: keyof typeof BED_LEVEL_DB, slices: Quantum[]) =>
    options.balance
      ? balancedMix(analysis, kind, slices)
      : mixFactor(analysis, slices);

  const intro = introSlices(analysis, duration);
  const parts: DubstepPart[] = [
    {
      kind: "intro",
      label: "intro",
      samples: ["intro-eight"],
      slices: intro,
      mix: mixOf("intro", intro),
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
      if (drop) {
        parts.push({
          kind: "drop",
          label: `section ${j + 1} drop`,
          samples: [`wubs/${key}`, splashName(splash)],
          slices,
          mix: mixOf("drop", slices),
        });
        return;
      }
      parts.push({
        kind: "break",
        label: `section ${j + 1} break`,
        samples: [`break-ends/${key}`, "hats"],
        slices,
        mix: mixOf("break", slices),
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

  return { tonic, parts };
}
