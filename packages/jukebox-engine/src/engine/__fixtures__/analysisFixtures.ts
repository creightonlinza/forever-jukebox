type SegmentShape = {
  start: number;
  duration: number;
  confidence?: number;
  loudness_start?: number;
  loudness_max?: number;
  loudness_max_time?: number;
  pitches?: number[];
  timbre?: number[];
};

function vector(seed: number, length = 12) {
  return Array.from({ length }, (_item, idx) => seed + idx * 0.01);
}

function segment({
  start,
  duration,
  confidence = 0.7,
  loudness_start = -20,
  loudness_max = -6,
  loudness_max_time = 0.12,
  pitches = vector(0.2),
  timbre = vector(1),
}: SegmentShape) {
  return {
    start,
    duration,
    confidence,
    loudness_start,
    loudness_max,
    loudness_max_time,
    pitches,
    timbre,
  };
}

function quanta(count: number, duration = 1, confidence = 0.8) {
  return Array.from({ length: count }, (_item, idx) => ({
    start: idx * duration,
    duration,
    confidence,
  }));
}

export function happyPathAnalysis() {
  const beats = quanta(12, 1, 0.72);
  return {
    sections: [
      { start: 0, duration: 4, confidence: 1 },
      { start: 4, duration: 4, confidence: 0.92 },
      { start: 8, duration: 4, confidence: 0.88 },
    ],
    bars: [
      { start: 0, duration: 4, confidence: 0.86 },
      { start: 4, duration: 4, confidence: 0.82 },
      { start: 8, duration: 4, confidence: 0.79 },
    ],
    beats,
    tatums: quanta(24, 0.5, 0.63),
    segments: beats.map((beat, idx) => {
      const phrase = idx % 4;
      return segment({
        start: beat.start,
        duration: beat.duration,
        confidence: 0.62 + phrase * 0.02,
        loudness_start: -22 + phrase,
        loudness_max: -8 + phrase * 0.4,
        pitches: vector(0.2 + phrase * 0.03),
        timbre: vector(1 + phrase * 0.05),
      });
    }),
    track: {
      duration: 12,
      tempo: 120,
      time_signature: 4,
      title: "Fixture Song",
      artist: "Fixture Artist",
    },
  };
}

export function nestedHappyPathAnalysis() {
  const analysis = happyPathAnalysis();
  const { track, ...root } = analysis;
  return { analysis: root, track };
}

export function tinyBranchAnalysis() {
  const beats = quanta(8, 1, 0.75);
  return {
    sections: [{ start: 0, duration: 8, confidence: 1 }],
    bars: [
      { start: 0, duration: 4, confidence: 0.9 },
      { start: 4, duration: 4, confidence: 0.9 },
    ],
    beats,
    tatums: quanta(16, 0.5, 0.65),
    segments: beats.map((beat, idx) => {
      const phrase = idx % 4;
      return segment({
        start: beat.start,
        duration: 1,
        loudness_start: -18 + phrase,
        loudness_max: -5 + phrase * 0.2,
        pitches: vector(0.3 + phrase * 0.02),
        timbre: vector(0.9 + phrase * 0.02),
      });
    }),
    track: { duration: 8, tempo: 100, time_signature: 4 },
  };
}

export function sparseLowBranchAnalysis() {
  const beats = quanta(10, 1, 0.7);
  return {
    sections: [{ start: 0, duration: 10, confidence: 1 }],
    bars: [
      { start: 0, duration: 5, confidence: 0.8 },
      { start: 5, duration: 5, confidence: 0.8 },
    ],
    beats,
    tatums: quanta(10, 1, 0.5),
    segments: beats.map((beat, idx) =>
      segment({
        start: beat.start,
        duration: 1,
        confidence: 0.3,
        loudness_start: -80 + idx * 15,
        loudness_max: -55 + idx * 12,
        pitches: vector(idx * 6),
        timbre: vector(idx * 8),
      }),
    ),
    track: { duration: 10, tempo: 90, time_signature: 4 },
  };
}

export function emptySegmentsAnalysis() {
  return {
    sections: [{ start: 0, duration: 4, confidence: 1 }],
    bars: [{ start: 0, duration: 4, confidence: 0.8 }],
    beats: quanta(4, 1, 0.7),
    tatums: quanta(8, 0.5, 0.5),
    segments: [],
    track: { duration: 4, tempo: 120, time_signature: 4 },
  };
}

export function oddTimingAnalysis() {
  return {
    sections: [{ start: 0, duration: 4, confidence: 1 }],
    bars: [{ start: 0, duration: 4, confidence: 0.8 }],
    beats: [
      { start: 0, duration: 1, confidence: 0.7 },
      { start: 1, duration: 0, confidence: 0.6 },
      { start: 1, duration: -0.25, confidence: 0.5 },
      { start: 0.75, duration: 1, confidence: 0.4 },
    ],
    tatums: quanta(4, 0.5, 0.5),
    segments: [
      segment({ start: 0, duration: 1 }),
      segment({ start: 1, duration: 1, pitches: vector(0.25), timbre: vector(1.25) }),
      segment({ start: 1, duration: 1, pitches: vector(0.5), timbre: vector(1.5) }),
      segment({ start: 0.75, duration: 1, pitches: vector(0.75), timbre: vector(1.75) }),
    ],
    track: { duration: 4, tempo: 120, time_signature: 4 },
  };
}

export function longBranchDensityAnalysis(totalBeats = 96) {
  const beats = quanta(totalBeats, 0.5, 0.7);
  return {
    sections: Array.from({ length: Math.ceil(totalBeats / 16) }, (_item, idx) => ({
      start: idx * 8,
      duration: 8,
      confidence: 0.9,
    })),
    bars: Array.from({ length: Math.ceil(totalBeats / 4) }, (_item, idx) => ({
      start: idx * 2,
      duration: 2,
      confidence: 0.8,
    })),
    beats,
    tatums: quanta(totalBeats * 2, 0.25, 0.55),
    segments: beats.map((beat, idx) => {
      const phrase = idx % 16;
      return segment({
        start: beat.start,
        duration: beat.duration,
        confidence: 0.55 + (phrase % 4) * 0.03,
        loudness_start: -24 + (phrase % 8),
        loudness_max: -10 + (phrase % 6) * 0.4,
        pitches: vector(0.1 + phrase * 0.015),
        timbre: vector(0.8 + phrase * 0.02),
      });
    }),
    track: { duration: totalBeats * 0.5, tempo: 120, time_signature: 4 },
  };
}
