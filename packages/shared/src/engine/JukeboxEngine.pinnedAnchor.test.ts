import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";
import { countTuningBranches } from "./selection";
import type { Edge } from "./types";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../test-fixtures/engine-parity",
);
const analysis = (
  JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "real-analysis-cases.json"), "utf8"),
  ) as { analysis: unknown }
).analysis;

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(() => true),
    cancelScheduledJump: vi.fn(),
    setAnchorJump: vi.fn(() => true),
    clearAnchorJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => false,
  };
}

// A backward edge offered at the auto threshold, other than the default anchor, with the
// largest distance so a lower threshold drops it.
function setUp() {
  const engine = new JukeboxEngine(makePlayer());
  engine.loadAnalysis(analysis);
  const graph = engine.getGraphState()!;
  const defaultAnchor = engine.getActiveAnchor()!;
  const pin = graph.allEdges
    .filter(
      (edge) =>
        !edge.deleted &&
        edge.dest.which < edge.src.which &&
        edge.src.neighbors.includes(edge) &&
        !(edge.src.which === defaultAnchor.src && edge.dest.which === defaultAnchor.dest),
    )
    .sort((a, b) => b.distance - a.distance)[0];
  engine.setUserAnchorEdge(pin);
  return { engine, pin, autoThreshold: graph.currentThreshold, defaultAnchor };
}

function offered(engine: JukeboxEngine, edge: Edge) {
  const graph = engine.getGraphState()!;
  return graph.allEdges
    .find((candidate) => candidate.id === edge.id)!
    .src.neighbors.filter((candidate) => candidate.id === edge.id).length;
}

function lowerBelow(engine: JukeboxEngine, edge: Edge) {
  engine.updateConfig({ currentThreshold: Math.floor(edge.distance) - 5 });
  engine.rebuildGraph();
}

describe("pinned anchor edge", () => {
  it("stays the anchor after a threshold below its distance", () => {
    const { engine, pin } = setUp();
    lowerBelow(engine, pin);

    expect(engine.getActiveAnchor()).toEqual({ src: pin.src.which, dest: pin.dest.which });
    expect(engine.getAnchorParam()).toEqual({ edgeId: pin.id });
    expect(offered(engine, pin)).toBe(1);
    expect(engine.getVisualizationData()?.userAnchorEdgeId).toBe(pin.id);
  });

  it("marks only a put-back pin as outside the branch count", () => {
    const { engine, pin } = setUp();
    expect(engine.getVisualizationData()?.putBackAnchorEdgeId).toBeNull();
    lowerBelow(engine, pin);
    const lowered = engine.getVisualizationData()!;
    engine.setUserAnchorEdge(null);
    const unpinned = engine.getVisualizationData()!;

    expect(lowered.putBackAnchorEdgeId).toBe(pin.id);
    expect(countTuningBranches(lowered)).toBe(countTuningBranches(unpinned));
    expect(unpinned.putBackAnchorEdgeId).toBeNull();
  });

  it("stays the anchor when the long-branch filter drops it", () => {
    const { engine, pin } = setUp();
    const length = pin.src.which - pin.dest.which;
    const totalBeats = engine.getGraphState()!.totalBeats;
    engine.updateConfig({
      justLongBranches: true,
      minLongBranchPercent: Math.ceil(((length + 1) * 100) / totalBeats),
    });
    engine.rebuildGraph();

    expect(engine.getActiveAnchor()).toEqual({ src: pin.src.which, dest: pin.dest.which });
    expect(offered(engine, pin)).toBe(1);
  });

  it("forces a pin applied from an ab value while a filter drops it", () => {
    const { engine, pin } = setUp();
    engine.setUserAnchorEdge(null);
    lowerBelow(engine, pin);
    expect(offered(engine, pin)).toBe(0);

    expect(engine.applyAnchorParam({ edgeId: pin.id })).toBe(true);
    expect(engine.getActiveAnchor()).toEqual({ src: pin.src.which, dest: pin.dest.which });
    expect(offered(engine, pin)).toBe(1);
  });

  it("takes the put-back edge out again when the pin is cleared", () => {
    const { engine, pin, defaultAnchor } = setUp();
    lowerBelow(engine, pin);

    engine.setUserAnchorEdge(null);

    expect(offered(engine, pin)).toBe(0);
    expect(engine.getActiveAnchor()).not.toEqual({ src: pin.src.which, dest: pin.dest.which });
    expect(engine.getAnchorParam()).toBeNull();
    expect(defaultAnchor).not.toEqual({ src: pin.src.which, dest: pin.dest.which });
  });

  it("takes the put-back edge out when a custom anchor replaces the pin", () => {
    const { engine, pin } = setUp();
    lowerBelow(engine, pin);

    expect(engine.setCustomAnchor(pin.src.which, Math.max(0, pin.src.which - 40))).toBe(true);

    expect(offered(engine, pin)).toBe(0);
  });

  it("takes the put-back edge out when branch edits are cleared", () => {
    const { engine, pin } = setUp();
    lowerBelow(engine, pin);

    engine.clearDeletedEdges();

    expect(offered(engine, pin)).toBe(0);
    expect(engine.getAnchorParam()).toBeNull();
  });

  it("unpins a deleted pin even while a filter drops it", () => {
    const { engine, pin } = setUp();
    lowerBelow(engine, pin);

    engine.deleteEdge(pin);
    engine.rebuildGraph();

    expect(offered(engine, pin)).toBe(0);
    expect(engine.getAnchorParam()).toBeNull();
  });

  it("returns when the threshold goes back up without a second copy", () => {
    const { engine, pin, autoThreshold } = setUp();
    lowerBelow(engine, pin);

    engine.updateConfig({ currentThreshold: autoThreshold });
    engine.rebuildGraph();

    expect(offered(engine, pin)).toBe(1);
    expect(engine.getAnchorParam()).toEqual({ edgeId: pin.id });
  });
});
