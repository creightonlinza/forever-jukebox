import { describe, expect, it } from "vitest";
import { normalizeAnalysis, parseAnalysis } from "./analysis";
import {
  emptySegmentsAnalysis,
  happyPathAnalysis,
  nestedHappyPathAnalysis,
  oddTimingAnalysis,
} from "./__fixtures__/analysisFixtures";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("parseAnalysis", () => {
  it("parses root-level analysis and track timing metadata", () => {
    const parsed = parseAnalysis(happyPathAnalysis());

    expect(parsed.beats).toHaveLength(12);
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.track).toEqual({
      duration: 12,
      tempo: 120,
      time_signature: 4,
      title: "Fixture Song",
      artist: "Fixture Artist",
    });
    expect(parsed.beats[0]).toEqual(
      expect.objectContaining({
        start: 0,
        duration: 1,
        confidence: 0.72,
        which: 0,
        prev: null,
        next: null,
        overlappingSegments: [],
        neighbors: [],
        allNeighbors: [],
      }),
    );
  });

  it("parses nested analysis payloads returned with top-level track metadata", () => {
    const parsed = parseAnalysis(nestedHappyPathAnalysis());

    expect(parsed.beats).toHaveLength(12);
    expect(parsed.segments).toHaveLength(12);
    expect(parsed.track?.duration).toBe(12);
    expect(parsed.track?.tempo).toBe(120);
    expect(parsed.track?.time_signature).toBe(4);
    expect(parsed.track?.title).toBe("Fixture Song");
    expect(parsed.track?.artist).toBe("Fixture Artist");
  });

  it("stringifies track title and artist metadata to match PWA normalization", () => {
    const payload = clone(happyPathAnalysis());
    (payload.track as { title: unknown; artist: unknown }).title = 1234;
    (payload.track as { title: unknown; artist: unknown }).artist = true;

    const parsed = parseAnalysis(payload);

    expect(parsed.track?.title).toBe("1234");
    expect(parsed.track?.artist).toBe("true");
  });

  it("allows missing quantum confidence while requiring segment confidence", () => {
    const payload = clone(happyPathAnalysis());
    delete (payload.beats[0] as { confidence?: number }).confidence;

    const parsed = parseAnalysis(payload);

    expect(parsed.beats[0].confidence).toBeUndefined();

    const missingSegmentConfidence = clone(payload);
    delete (missingSegmentConfidence.segments[0] as { confidence?: number })
      .confidence;
    expect(() => parseAnalysis(missingSegmentConfidence)).toThrow(
      "Expected number at segments[0].confidence",
    );
  });

  it("rejects missing arrays, non-number fields, NaN, and short vectors", () => {
    const cases: Array<[string, unknown, string]> = [
      [
        "missing beats",
        (() => {
          const payload = clone(happyPathAnalysis()) as Record<string, unknown>;
          delete payload.beats;
          return payload;
        })(),
        "Expected array at beats",
      ],
      [
        "bad beat start",
        (() => {
          const payload = clone(happyPathAnalysis());
          (payload.beats[0] as { start: unknown }).start = "0";
          return payload;
        })(),
        "Expected number at beats[0].start",
      ],
      [
        "NaN duration",
        (() => {
          const payload = clone(happyPathAnalysis());
          (payload.beats[0] as { duration: number }).duration = Number.NaN;
          return payload;
        })(),
        "Expected number at beats[0].duration",
      ],
      [
        "short pitches",
        (() => {
          const payload = clone(happyPathAnalysis());
          payload.segments[0].pitches = new Array(11).fill(0);
          return payload;
        })(),
        "Expected 12+ numbers at segments[0].pitches",
      ],
      [
        "non-number timbre item",
        (() => {
          const payload = clone(happyPathAnalysis());
          (payload.segments[0].timbre as unknown[])[3] = "loud";
          return payload;
        })(),
        "Expected number at segments[0].timbre[3]",
      ],
    ];

    for (const [name, payload, message] of cases) {
      expect(() => parseAnalysis(payload), name).toThrow(message);
    }
  });
});

describe("normalizeAnalysis", () => {
  it("links quanta, parents, children, and overlapping segments", () => {
    const analysis = normalizeAnalysis(happyPathAnalysis());

    expect(analysis.beats[0].next?.which).toBe(1);
    expect(analysis.beats[1].prev?.which).toBe(0);
    expect(analysis.bars[0].children?.map((beat) => beat.which)).toEqual([
      0,
      1,
      2,
      3,
    ]);
    expect(analysis.beats[0].parent?.which).toBe(0);
    expect(analysis.beats[4].parent?.which).toBe(1);
    expect(analysis.beats[0].indexInParent).toBe(0);
    expect(analysis.beats[0].oseg?.which).toBe(0);
    expect(analysis.beats[0].overlappingSegments.map((seg) => seg.which)).toEqual([
      0,
      1,
    ]);
  });

  it("preserves empty arrays and does not synthesize graph state", () => {
    const analysis = normalizeAnalysis({
      sections: [],
      bars: [],
      beats: [],
      tatums: [],
      segments: [],
      track: {},
    });

    expect(analysis.sections).toEqual([]);
    expect(analysis.beats).toEqual([]);
    expect(analysis.segments).toEqual([]);
  });

  it("preserves duplicate starts, zero durations, negative durations, and unsorted timing", () => {
    const analysis = normalizeAnalysis(oddTimingAnalysis());

    expect(analysis.beats.map((beat) => beat.start)).toEqual([0, 1, 1, 0.75]);
    expect(analysis.beats.map((beat) => beat.duration)).toEqual([
      1,
      0,
      -0.25,
      1,
    ]);
    expect(analysis.beats.map((beat) => beat.which)).toEqual([0, 1, 2, 3]);
  });

  it("treats overlap boundaries as inclusive on both sides", () => {
    const payload = {
      sections: [{ start: 0, duration: 3, confidence: 1 }],
      bars: [{ start: 0, duration: 3, confidence: 1 }],
      beats: [
        { start: 0, duration: 1, confidence: 1 },
        { start: 1, duration: 1, confidence: 1 },
      ],
      tatums: [],
      segments: [
        {
          start: 0.5,
          duration: 0.5,
          confidence: 1,
          loudness_start: -10,
          loudness_max: -3,
          loudness_max_time: 0.1,
          pitches: new Array(12).fill(0),
          timbre: new Array(12).fill(0),
        },
        {
          start: 2,
          duration: 0.25,
          confidence: 1,
          loudness_start: -10,
          loudness_max: -3,
          loudness_max_time: 0.1,
          pitches: new Array(12).fill(1),
          timbre: new Array(12).fill(1),
        },
      ],
      track: { duration: 3 },
    };

    const analysis = normalizeAnalysis(payload);

    expect(analysis.beats[1].overlappingSegments.map((seg) => seg.which)).toEqual([
      0,
      1,
    ]);
  });

  it("keeps quanta valid when the analysis has no segments", () => {
    const analysis = normalizeAnalysis(emptySegmentsAnalysis());

    expect(analysis.beats).toHaveLength(4);
    expect(analysis.beats[0].oseg).toBeUndefined();
    expect(analysis.beats[0].overlappingSegments).toEqual([]);
    expect(analysis.beats[0].next?.which).toBe(1);
  });
});
