import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "./analysis";
import { buildJumpGraph } from "./graph";
import { Edge, JukeboxConfig, QuantumBase } from "./types";

function makeAnalysis() {
  return {
    sections: [{ start: 0, duration: 4, confidence: 1 }],
    bars: [
      { start: 0, duration: 2, confidence: 0.8 },
      { start: 2, duration: 2, confidence: 0.8 },
    ],
    beats: [
      { start: 0, duration: 1, confidence: 0.6 },
      { start: 1, duration: 1, confidence: 0.6 },
      { start: 2, duration: 1, confidence: 0.6 },
      { start: 3, duration: 1, confidence: 0.6 },
    ],
    tatums: [
      { start: 0, duration: 0.5, confidence: 0.5 },
      { start: 0.5, duration: 0.5, confidence: 0.5 },
      { start: 1, duration: 0.5, confidence: 0.5 },
      { start: 1.5, duration: 0.5, confidence: 0.5 },
    ],
    segments: [
      {
        start: 0,
        duration: 1,
        confidence: 0.4,
        loudness_start: -20,
        loudness_max: -5,
        loudness_max_time: 0.2,
        pitches: new Array(12).fill(0.5),
        timbre: new Array(12).fill(1),
      },
      {
        start: 1,
        duration: 1,
        confidence: 0.4,
        loudness_start: -19,
        loudness_max: -5,
        loudness_max_time: 0.2,
        pitches: new Array(12).fill(0.51),
        timbre: new Array(12).fill(1.1),
      },
      {
        start: 2,
        duration: 1,
        confidence: 0.4,
        loudness_start: -18,
        loudness_max: -4.5,
        loudness_max_time: 0.2,
        pitches: new Array(12).fill(0.52),
        timbre: new Array(12).fill(1.2),
      },
      {
        start: 3,
        duration: 1,
        confidence: 0.4,
        loudness_start: -17,
        loudness_max: -4.2,
        loudness_max_time: 0.2,
        pitches: new Array(12).fill(0.53),
        timbre: new Array(12).fill(1.3),
      },
    ],
    track: { duration: 4 },
  };
}

function makeLinearAnalysis(totalBeats: number) {
  return {
    sections: [{ start: 0, duration: totalBeats, confidence: 1 }],
    bars: Array.from({ length: totalBeats }, (_, i) => ({
      start: i,
      duration: 1,
      confidence: 0.8,
    })),
    beats: Array.from({ length: totalBeats }, (_, i) => ({
      start: i,
      duration: 1,
      confidence: 0.7,
    })),
    tatums: Array.from({ length: totalBeats }, (_, i) => ({
      start: i,
      duration: 1,
      confidence: 0.6,
    })),
    segments: Array.from({ length: totalBeats }, (_, i) => ({
      start: i,
      duration: 1,
      confidence: 0.5,
      loudness_start: -20 + i * 0.1,
      loudness_max: -8 + i * 0.1,
      loudness_max_time: 0.2,
      pitches: new Array(12).fill(0.3 + i * 0.001),
      timbre: new Array(12).fill(0.8 + i * 0.001),
    })),
    track: { duration: totalBeats },
  };
}

function makeEdge(
  id: number,
  src: QuantumBase,
  dest: QuantumBase,
  distance: number,
): Edge {
  return {
    id,
    src,
    dest,
    distance,
    deleted: false,
  };
}

function makeCachedAnchorScenario(
  existingAnchorDest: number,
  earliestBackwardDest?: number,
) {
  const analysis = normalizeAnalysis(makeLinearAnalysis(7));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Optional earlier backward destination to define branch-onset beat.
  if (earliestBackwardDest !== undefined) {
    push(3, earliestBackwardDest, 10);
  }
  // Existing branch in last third that may or may not be an acceptable anchor.
  push(6, existingAnchorDest, 10);
  // Candidate branch above threshold that anchor insertion would add if needed.
  push(5, 0, 40);
  return analysis;
}

function makeLateLongAnchorPreferenceScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Earlier direct anchor candidate (0 hops to target).
  push(7, 2, 5);
  // Later long candidate that needs one extra hop to target.
  push(9, 6, 5);
  push(6, 2, 5);
  return analysis;
}

function makeLateQualityBeatsLatestScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Latest late-track source (9) qualifies but only with a very short immediate jump.
  push(9, 7, 10);
  push(7, 2, 10);
  // Slightly earlier late-track source (8) is a better direct return.
  push(8, 2, 10);
  return analysis;
}

function makeLateNearQualityPrefersLatestScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Earlier direct branch with strongest quality metrics.
  push(8, 2, 10);
  // Latest branch is one hop worse, but still close in quality.
  push(9, 4, 10);
  push(4, 2, 10);
  return analysis;
}

function makeFallbackRangeAnchorScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // No qualifying branches in preferred late window (8-9).
  // Fallback late-range candidate in 66-80% window should be selected.
  push(7, 2, 10);
  return analysis;
}

function makeGoodTierFallbackScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // No best-tier candidate (minLongBranch=4 in test config).
  // This candidate should be chosen when rule evaluation falls to "good".
  push(9, 6, 10);
  push(6, 3, 10);
  push(3, 2, 10);
  return analysis;
}

function makeExactTiePrefersLaterSourceScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Source 8 and 9 produce equal quality outcomes:
  // branchesToTarget=1, earliestReachable=2, immediateBackward=4, same distance.
  push(8, 4, 10);
  push(9, 5, 10);
  push(4, 2, 10);
  push(5, 2, 10);
  return analysis;
}

function makeInsertionWithoutExistingAnchorScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Define early target and provide only an above-threshold late insertion option.
  push(3, 1, 10);
  push(8, 1, 40);
  return analysis;
}

function makeLateHintClampScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(100));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Preferred late candidate only reaches near the end.
  push(90, 86, 10);
  // Fallback late-range candidate reaches much earlier in track.
  push(75, 55, 10);
  return analysis;
}

function makeLateOnsetTargetScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(100));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // All backward branching starts late in the track.
  push(90, 70, 10);
  push(75, 70, 10);
  return analysis;
}

function makeLateInsertionPreferenceScenario() {
  const analysis = normalizeAnalysis(makeLinearAnalysis(10));
  const beats = analysis.beats;
  for (const beat of beats) {
    beat.allNeighbors = [];
    beat.neighbors = [];
  }
  let id = 0;
  const push = (src: number, dest: number, distance: number) => {
    beats[src].allNeighbors.push(makeEdge(id, beats[src], beats[dest], distance));
    id += 1;
  };
  // Keep beat 0 non-empty so graph build uses cached neighbors.
  push(0, 2, 10);
  // Earlier existing anchor candidate in the last third, but before final 20%.
  push(6, 4, 10);
  // Defines branch-onset target earlier than the existing anchor destination.
  push(3, 1, 10);
  // Late candidate above threshold that should be inserted and preferred.
  push(8, 0, 40);
  return analysis;
}

function collectEdgeKeys(analysis: ReturnType<typeof normalizeAnalysis>): string[] {
  const keys: string[] = [];
  for (const beat of analysis.beats) {
    for (const edge of beat.neighbors) {
      keys.push(`${edge.src.which}->${edge.dest.which}`);
    }
  }
  return keys.sort();
}

describe("buildJumpGraph", () => {
  it("builds neighbors and a last branch point", () => {
    const analysis = normalizeAnalysis(makeAnalysis());
    const config: JukeboxConfig = {
      maxBranches: 3,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph = buildJumpGraph(analysis, config);
    expect(graph.totalBeats).toBe(4);
    expect(graph.lastBranchPoint).toBeGreaterThanOrEqual(0);
    expect(analysis.beats.some((beat) => beat.neighbors.length > 0)).toBe(true);
  });

  it("respects justBackwards and justLongBranches filters", () => {
    const analysis = normalizeAnalysis(makeAnalysis());
    const config: JukeboxConfig = {
      maxBranches: 3,
      maxBranchThreshold: 80,
      currentThreshold: 80,
      justBackwards: true,
      justLongBranches: true,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 2,
    };
    const graph = buildJumpGraph(analysis, config);
    expect(graph.totalBeats).toBe(4);
    for (const beat of analysis.beats) {
      for (const neighbor of beat.neighbors) {
        expect(neighbor.dest.which).toBeLessThan(beat.which);
        expect(Math.abs(neighbor.dest.which - beat.which)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("filters sequential branches when enabled", () => {
    const analysis = normalizeAnalysis(makeAnalysis());
    const config: JukeboxConfig = {
      maxBranches: 3,
      maxBranchThreshold: 80,
      currentThreshold: 80,
      justBackwards: true,
      justLongBranches: false,
      removeSequentialBranches: true,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph = buildJumpGraph(analysis, config);
    const lastBranchPoint = graph.lastBranchPoint;
    for (let i = 1; i < analysis.beats.length; i += 1) {
      if (i === lastBranchPoint) {
        continue;
      }
      const prev = analysis.beats[i - 1];
      const current = analysis.beats[i];
      const prevDistances = new Set(
        prev.neighbors.map((edge) => prev.which - edge.dest.which),
      );
      for (const edge of current.neighbors) {
        const distance = current.which - edge.dest.which;
        expect(prevDistances.has(distance)).toBe(false);
      }
    }
  });

  it("uses computed threshold when currentThreshold is 0", () => {
    const analysis = normalizeAnalysis(makeAnalysis());
    const config: JukeboxConfig = {
      maxBranches: 3,
      maxBranchThreshold: 80,
      currentThreshold: 0,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph = buildJumpGraph(analysis, config);
    expect(graph.currentThreshold).toBe(graph.computedThreshold);
    expect(graph.currentThreshold).toBeGreaterThan(0);
  });

  it("keeps computed threshold when currentThreshold is provided", () => {
    const analysis = normalizeAnalysis(makeAnalysis());
    const config: JukeboxConfig = {
      maxBranches: 3,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const graph = buildJumpGraph(analysis, config);
    expect(graph.currentThreshold).toBe(60);
    expect(graph.computedThreshold).toBeGreaterThan(0);
  });

  it("reuses cached neighbors and still returns allEdges", () => {
    const analysis = normalizeAnalysis(makeAnalysis());
    const config: JukeboxConfig = {
      maxBranches: 3,
      maxBranchThreshold: 80,
      currentThreshold: 60,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };
    const first = buildJumpGraph(analysis, config);
    const firstCount = first.allEdges.length;
    expect(firstCount).toBeGreaterThan(0);

    const second = buildJumpGraph(analysis, config);
    expect(second.allEdges.length).toBe(firstCount);
  });

  it("skips insertion when an existing end branch already reaches early target", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };

    const analysis = makeCachedAnchorScenario(1);
    const graph = buildJumpGraph(analysis, config);
    const edges = collectEdgeKeys(analysis);

    expect(edges.includes("5->0")).toBe(false);
    expect(graph.lastBranchPoint).toBe(6);
  });

  it("inserts anchor when existing end branch does not reach early target", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 1,
    };

    const analysis = makeLateInsertionPreferenceScenario();
    const graph = buildJumpGraph(analysis, config);
    const edges = collectEdgeKeys(analysis);

    expect(edges.includes("8->0")).toBe(true);
    expect(graph.lastBranchPoint).toBe(8);
  });

  it("prefers a later long branch even when it needs one extra hop", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 2,
    };

    const analysis = makeLateLongAnchorPreferenceScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(9);
    expect(
      analysis.beats[graph.lastBranchPoint].neighbors.some(
        (edge) => edge.dest.which === 6,
      ),
    ).toBe(true);
  });

  it("prefers higher-quality late candidates over latest qualifying source", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 2,
    };

    const analysis = makeLateQualityBeatsLatestScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(8);
    expect(
      analysis.beats[graph.lastBranchPoint].neighbors.some(
        (edge) => edge.dest.which === 2,
      ),
    ).toBe(true);
  });

  it("prefers latest candidate when quality is close enough", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 2,
    };

    const analysis = makeLateNearQualityPrefersLatestScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(9);
    expect(
      analysis.beats[graph.lastBranchPoint].neighbors.some(
        (edge) => edge.dest.which === 4,
      ),
    ).toBe(true);
  });

  it("uses fallback late range when preferred late window has no candidate", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 2,
    };

    const analysis = makeFallbackRangeAnchorScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(7);
  });

  it("falls back from best tier to good tier when needed", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 4,
    };

    const analysis = makeGoodTierFallbackScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(9);
    expect(
      analysis.beats[graph.lastBranchPoint].neighbors.some(
        (edge) => edge.dest.which === 6,
      ),
    ).toBe(true);
  });

  it("prefers later source when candidates tie on quality", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 4,
    };

    const analysis = makeExactTiePrefersLaterSourceScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(9);
  });

  it("inserts anchor when no existing candidate qualifies", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 2,
    };

    const analysis = makeInsertionWithoutExistingAnchorScenario();
    const graph = buildJumpGraph(analysis, config);
    const edges = collectEdgeKeys(analysis);

    expect(edges.includes("8->1")).toBe(true);
    expect(graph.lastBranchPoint).toBe(8);
  });

  it("caps late-source target hints so near-end anchors do not win by default", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 15,
    };

    const analysis = makeLateHintClampScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(75);
  });

  it("preserves late-onset targets when first backward branches are late", () => {
    const config: JukeboxConfig = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.018,
      minLongBranch: 15,
    };

    const analysis = makeLateOnsetTargetScenario();
    const graph = buildJumpGraph(analysis, config);

    expect(graph.lastBranchPoint).toBe(90);
  });
});
