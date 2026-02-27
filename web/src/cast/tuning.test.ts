import { describe, expect, it, vi } from "vitest";
import type { JukeboxConfig } from "../engine/types";
import {
  applyCastTuningToEngine,
  parseCastTuningParams,
  type CastTuningEngine,
} from "./tuning";

function makeDefaults(): JukeboxConfig {
  return {
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
}

function makeEngine(): CastTuningEngine {
  const edgeA = {
    id: 1,
    src: { which: 4 },
    dest: { which: 1 },
    deleted: false,
  } as any;
  return {
    updateConfig: vi.fn(),
    clearDeletedEdges: vi.fn(),
    rebuildGraph: vi.fn(),
    getGraphState: vi.fn(() => ({
      computedThreshold: 20,
      currentThreshold: 20,
      lastBranchPoint: 4,
      totalBeats: 10,
      longestReach: 0,
      allEdges: [edgeA],
    })),
    deleteEdge: vi.fn(),
  };
}

describe("cast tuning", () => {
  it("parses supported fields including booleans and highlight", () => {
    const parsed = parseCastTuningParams(
      "jb=1&lg=0&sq=0&thresh=31&bp=10,20,30&d=1,3&ah=1",
      makeDefaults(),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.config.justBackwards).toBe(true);
    expect(parsed?.config.justLongBranches).toBe(false);
    expect(parsed?.config.removeSequentialBranches).toBe(true);
    expect(parsed?.config.currentThreshold).toBe(31);
    expect(parsed?.deletedEdgeIds).toEqual([1, 3]);
    expect(parsed?.highlightAnchorBranch).toBe(true);
    expect(parsed?.hasGraphTuning).toBe(true);
  });

  it("ignores threshold values below cast minimum", () => {
    const defaults = makeDefaults();
    const parsed = parseCastTuningParams("thresh=0&jb=1", defaults);
    expect(parsed?.config.currentThreshold).toBe(defaults.currentThreshold);
  });

  it("returns null when no tuning keys are present", () => {
    expect(parseCastTuningParams("foo=bar", makeDefaults())).toBeNull();
  });

  it("short-circuits graph work for highlight-only payloads", () => {
    const engine = makeEngine();
    const result = applyCastTuningToEngine(engine, makeDefaults(), "ah=1");
    expect(result.highlightOnly).toBe(true);
    expect(result.highlightAnchorBranch).toBe(true);
    expect(engine.updateConfig).not.toHaveBeenCalled();
    expect(engine.clearDeletedEdges).not.toHaveBeenCalled();
    expect(engine.rebuildGraph).not.toHaveBeenCalled();
  });

  it("applies config and deleted edges for graph-tuning payloads", () => {
    const engine = makeEngine();
    const defaults = makeDefaults();
    const result = applyCastTuningToEngine(
      engine,
      defaults,
      "jb=1&thresh=33&d=1&ah=0",
    );
    expect(result.highlightOnly).toBe(false);
    expect(result.highlightAnchorBranch).toBe(false);
    expect(engine.updateConfig).toHaveBeenCalledTimes(2);
    expect(engine.updateConfig).toHaveBeenNthCalledWith(1, defaults);
    expect(engine.clearDeletedEdges).toHaveBeenCalledTimes(1);
    expect(engine.rebuildGraph).toHaveBeenCalledTimes(2);
    expect(engine.deleteEdge).toHaveBeenCalledTimes(1);
  });
});
