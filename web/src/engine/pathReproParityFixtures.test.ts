import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/backgroundTimer", () => ({
  backgroundSetTimeout: (
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => globalThis.setTimeout(callback, delay, ...args),
  backgroundClearTimeout: (id: number) => globalThis.clearTimeout(id),
}));

import { JukeboxEngine, type JukeboxPlayer, DEFAULT_JUKEBOX_CONFIG } from "./JukeboxEngine";
import { buildJumpGraph } from "./graph";
import { BranchState, selectNextBeatIndex } from "./selection";
import { createRng, type RandomMode } from "./random";
import type { Edge, JukeboxConfig, JukeboxGraphState, QuantumBase, TrackAnalysis } from "./types";

type FixtureRandomMode = "Seeded" | "Deterministic";

type FixtureCase = {
  id: string;
  beats: number;
  steps: number;
  randomMode?: FixtureRandomMode;
  seed?: number;
  config: Partial<JukeboxConfig>;
  edges: Array<[number, number, number]>;
  expected: {
    beatTrace: number[];
    jumpTrace: boolean[];
  };
};

type FixtureDoc = {
  schema_version: number;
  cases: FixtureCase[];
};

type SessionTrace = {
  beatTrace: number[];
  jumpTrace: boolean[];
};

function makeBeat(which: number): QuantumBase {
  return {
    start: which,
    duration: 1,
    which,
    prev: null,
    next: null,
    overlappingSegments: [],
    neighbors: [],
    allNeighbors: [],
  };
}

function linkBeats(beats: QuantumBase[]) {
  beats.forEach((beat, idx) => {
    beat.prev = idx > 0 ? beats[idx - 1] : null;
    beat.next = idx < beats.length - 1 ? beats[idx + 1] : null;
  });
}

function makeAnalysis(totalBeats: number): TrackAnalysis {
  const beats = Array.from({ length: totalBeats }, (_, idx) => makeBeat(idx));
  linkBeats(beats);
  return {
    sections: [],
    bars: [],
    beats,
    tatums: [],
    segments: [],
    track: { duration: totalBeats },
  };
}

function makeEdge(id: number, src: QuantumBase, dest: QuantumBase, distance: number): Edge {
  return {
    id,
    src,
    dest,
    distance,
    deleted: false,
  };
}

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(),
    cancelScheduledJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => true,
  };
}

function configFromFixture(config: Partial<JukeboxConfig>): JukeboxConfig {
  return {
    ...DEFAULT_JUKEBOX_CONFIG,
    ...config,
  };
}

function loadFixture(): FixtureDoc {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    currentDir,
    "../../../test-fixtures/engine-parity/path-repro-cases.json",
  );
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureDoc;
}

function randomModeFromFixture(mode: string | undefined, id: string): RandomMode {
  const effectiveMode = mode ?? "Seeded";
  if (effectiveMode === "Seeded") {
    return "seeded";
  }
  if (effectiveMode === "Deterministic") {
    return "deterministic";
  }
  throw new Error(
    `${id}: randomMode must be Seeded or Deterministic for exact parity fixtures`,
  );
}

function buildFixtureGraph(
  beats: number,
  edges: Array<[number, number, number]>,
  config: JukeboxConfig,
): { analysis: TrackAnalysis; graph: JukeboxGraphState } {
  const analysis = makeAnalysis(beats);
  let edgeId = 0;
  for (const [src, dest, distance] of edges) {
    analysis.beats[src].allNeighbors.push(
      makeEdge(edgeId, analysis.beats[src], analysis.beats[dest], distance),
    );
    edgeId += 1;
  }
  const graph = buildJumpGraph(analysis, config);
  return { analysis, graph };
}

function simulatePathTrace(
  beats: number,
  edges: Array<[number, number, number]>,
  config: JukeboxConfig,
  mode: RandomMode,
  seed: number | undefined,
  steps: number,
): SessionTrace {
  const { analysis, graph } = buildFixtureGraph(beats, edges, config);
  const rng = createRng(mode, seed);
  const branchState: BranchState = {
    curRandomBranchChance: config.minRandomBranchChance,
  };
  let curRandomBranchChance = config.minRandomBranchChance;
  let currentBeatIndex = -1;
  const beatTrace: number[] = [];
  const jumpTrace: boolean[] = [];

  for (let i = 0; i < steps; i += 1) {
    let chosenIndex = 0;
    let jumped = false;

    if (currentBeatIndex >= 0) {
      const nextIndex =
        currentBeatIndex + 1 >= analysis.beats.length ? 0 : currentBeatIndex + 1;
      const seedBeat = analysis.beats[nextIndex];
      branchState.curRandomBranchChance = curRandomBranchChance;
      const selection = selectNextBeatIndex(
        seedBeat,
        graph,
        config,
        rng,
        branchState,
        false,
      );
      curRandomBranchChance = branchState.curRandomBranchChance;
      jumped = selection.jumped;
      chosenIndex = jumped ? selection.index : nextIndex;

      if (nextIndex === 0 && currentBeatIndex === analysis.beats.length - 1) {
        jumped = true;
      }
    }

    beatTrace.push(chosenIndex);
    jumpTrace.push(jumped);
    currentBeatIndex = chosenIndex;
  }

  return { beatTrace, jumpTrace };
}

function simulatePathTraceWithEngine(
  beats: number,
  edges: Array<[number, number, number]>,
  config: JukeboxConfig,
  mode: RandomMode,
  seed: number | undefined,
  steps: number,
): SessionTrace {
  const { analysis, graph } = buildFixtureGraph(beats, edges, config);
  const player = makePlayer();
  const engine = new JukeboxEngine(player, {
    randomMode: mode,
    seed,
    config,
  });

  const engineAny = engine as unknown as {
    analysis: TrackAnalysis;
    graph: JukeboxGraphState;
    beats: QuantumBase[];
    currentBeatIndex: number;
    nextAudioTime: number;
    beatsPlayed: number;
    curRandomBranchChance: number;
    branchState: BranchState;
    lastJumped: boolean;
    lastJumpFromIndex: number | null;
    advanceBeat: (audioTime: number) => void;
  };

  engineAny.analysis = analysis;
  engineAny.graph = graph;
  engineAny.beats = analysis.beats;
  engineAny.currentBeatIndex = -1;
  engineAny.nextAudioTime = 0;
  engineAny.beatsPlayed = 0;
  engineAny.curRandomBranchChance = config.minRandomBranchChance;
  engineAny.branchState.curRandomBranchChance = config.minRandomBranchChance;
  engineAny.lastJumped = false;
  engineAny.lastJumpFromIndex = null;

  const beatTrace: number[] = [];
  const jumpTrace: boolean[] = [];
  for (let i = 0; i < steps; i += 1) {
    engineAny.advanceBeat(i);
    beatTrace.push(engineAny.currentBeatIndex);
    jumpTrace.push(engineAny.lastJumped);

    if (engineAny.lastJumped) {
      expect(engineAny.lastJumpFromIndex, `step ${i}: jump source`).not.toBeNull();
    } else {
      expect(engineAny.lastJumpFromIndex, `step ${i}: no jump source`).toBeNull();
    }
  }

  const scheduleJumpCallCount = (
    player.scheduleJump as ReturnType<typeof vi.fn>
  ).mock.calls.length;
  expect(scheduleJumpCallCount, "scheduleJump count").toBe(
    jumpTrace.filter(Boolean).length,
  );

  return { beatTrace, jumpTrace };
}

describe("path repro parity fixtures", () => {
  it("matches Android beat and jump traces with selection simulation", () => {
    const fixture = loadFixture();

    for (const testCase of fixture.cases) {
      const config = configFromFixture(testCase.config);
      const mode = randomModeFromFixture(testCase.randomMode, testCase.id);

      const sessionA = simulatePathTrace(
        testCase.beats,
        testCase.edges,
        config,
        mode,
        testCase.seed,
        testCase.steps,
      );
      const sessionB = simulatePathTrace(
        testCase.beats,
        testCase.edges,
        config,
        mode,
        testCase.seed,
        testCase.steps,
      );

      expect(sessionA.beatTrace.length, `${testCase.id}: beat trace length`).toBe(
        testCase.steps,
      );
      expect(sessionA.jumpTrace.length, `${testCase.id}: jump trace length`).toBe(
        testCase.steps,
      );
      expect(sessionA.beatTrace, `${testCase.id}: beat trace reproducibility`).toEqual(
        sessionB.beatTrace,
      );
      expect(sessionA.jumpTrace, `${testCase.id}: jump trace reproducibility`).toEqual(
        sessionB.jumpTrace,
      );
      expect(sessionA.jumpTrace.some(Boolean), `${testCase.id}: at least one jump`).toBe(
        true,
      );

      expect(
        sessionA.beatTrace,
        `${testCase.id}: expected beat trace`,
      ).toEqual(testCase.expected.beatTrace);
      expect(
        sessionA.jumpTrace,
        `${testCase.id}: expected jump trace`,
      ).toEqual(testCase.expected.jumpTrace);
    }
  });

  it("matches Android traces through JukeboxEngine advanceBeat behavior", () => {
    const fixture = loadFixture();

    for (const testCase of fixture.cases) {
      const config = configFromFixture(testCase.config);
      const mode = randomModeFromFixture(testCase.randomMode, testCase.id);
      const session = simulatePathTraceWithEngine(
        testCase.beats,
        testCase.edges,
        config,
        mode,
        testCase.seed,
        testCase.steps,
      );

      expect(
        session.beatTrace,
        `${testCase.id}: engine beat trace`,
      ).toEqual(testCase.expected.beatTrace);
      expect(
        session.jumpTrace,
        `${testCase.id}: engine jump trace`,
      ).toEqual(testCase.expected.jumpTrace);
    }
  });
});
