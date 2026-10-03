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

export type SourceSlice = { start: number; duration: number };

export type DubstepAnalysis = {
  sections: SourceSlice[];
  beats: SourceSlice[];
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

function end(quantum: SourceSlice) {
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

function beatsInSection(analysis: DubstepAnalysis, section: SourceSlice) {
  return analysis.beats.filter(
    (beat) => beat.start >= section.start && beat.start < end(section),
  );
}

// Beats of the section that contain the end of a segment whose strongest
// pitch is `pitch` and which spans the start of a beat of the section.
function getSamples(
  analysis: DubstepAnalysis,
  section: SourceSlice,
  pitch: number,
): SourceSlice[] {
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
): SourceSlice[] {
  const { sections } = analysis;
  let j = sectionIndex;
  let key = pitch;
  let found = getSamples(analysis, sections[j] as SourceSlice, key);
  for (let tries = 0; tries < 5; tries += 1) {
    if (found.length > 0) {
      return found;
    }
    key = (key + 7) % 12;
    found = getSamples(analysis, sections[j] as SourceSlice, key);
  }
  for (let tries = 0; tries < 5; tries += 1) {
    if (found.length > 0) {
      break;
    }
    j = (j + 1) % sections.length;
    key = (key + 2) % 12;
    found = getSamples(analysis, sections[j] as SourceSlice, key);
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
export function mixFactor(analysis: DubstepAnalysis, slices: SourceSlice[]) {
  const rangeStart = (slices[0] as SourceSlice).start;
  const rangeEnd = end(slices[slices.length - 1] as SourceSlice);
  const spanned = analysis.segments.filter(
    (segment) => end(segment) > rangeStart && segment.start < rangeEnd,
  );
  const loud = trackLoudness(spanned) || trackLoudness(analysis.segments);
  const mix = loud === -MIX_B ? 0 : (loud + MIX_A) / (loud + MIX_B);
  return Math.max(MIN_MIX, Math.min(MAX_MIX, mix));
}

function introSlices(analysis: DubstepAnalysis, duration: number) {
  let beats = analysis.beats.slice(0, 16);
  if (beats.length < 16) {
    const length = duration / 16;
    beats = Array.from({ length: 16 }, (_, i) => ({
      start: i * length,
      duration: length,
    }));
  }
  const at = (index: number) => beats[index] as SourceSlice;
  const cut = (beat: SourceSlice, divisor: number): SourceSlice => ({
    start: beat.start,
    duration: beat.duration / divisor,
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

// 16 beats, played twice: 8 on the tonic, 4 a minor third up, 4 a major sixth up.
function sectionSlices(
  analysis: DubstepAnalysis,
  sectionIndex: number,
  tonic: number,
): SourceSlice[] | null {
  const find = (pitch: number) => searchSamples(analysis, sectionIndex, pitch);
  let [s1, s2, s3] = [
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
      analysis.sections[sectionIndex] as SourceSlice,
    );
  }
  if (biggest.length === 0) {
    return null;
  }
  s1 = s1.length > 0 ? s1 : biggest;
  s2 = s2.length > 0 ? s2 : biggest;
  s3 = s3.length > 0 ? s3 : biggest;
  const bar: SourceSlice[] = [];
  for (let i = 0; i < 16; i += 1) {
    const pool = i < 8 ? s1 : i < 12 ? s2 : s3;
    bar.push(pool[i % pool.length] as SourceSlice);
  }
  return [...bar, ...bar];
}

export function planDubstepRemix(analysis: DubstepAnalysis): DubstepPlan {
  const { sections, beats, segments, track } = analysis;
  const lastSegment = segments[segments.length - 1];
  const duration = track?.duration ?? (lastSegment ? end(lastSegment) : 0);
  const sourceTempo =
    beats.length < 16 || !track?.tempo ? (60 * 16) / duration : track.tempo;
  const tonic = estimateTonic(segments);
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
  sections.forEach((_, j) => {
    const slices = sectionSlices(analysis, j, tonic);
    if (!slices) {
      return;
    }
    const mix = mixFactor(analysis, slices);
    const splash = SPLASH_ORDER[(j + 1) % SPLASH_ORDER.length] as number;
    parts.push(
      {
        kind: "drop",
        label: `section ${j + 1} drop`,
        samples: [`wubs/${key}`, splashName(splash)],
        slices,
        mix,
      },
      {
        kind: "break",
        label: `section ${j + 1} break`,
        samples: [`break-ends/${key}`, "hats"],
        slices,
        mix,
      },
    );
  });
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
