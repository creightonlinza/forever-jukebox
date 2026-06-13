import { describe, expect, it, vi } from "vitest";
import type { JukeboxConfig } from "@forever-jukebox/engine/types";
import {
  CAST_AUDIO_MODE_CAPABILITIES,
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
  const edgeB = {
    id: 2,
    src: { which: 1 },
    dest: { which: 5 },
    deleted: false,
  } as any;
  return {
    updateConfig: vi.fn(),
    clearDeletedEdges: vi.fn(() => {
      edgeA.deleted = false;
      edgeB.deleted = false;
    }),
    rebuildGraph: vi.fn(),
    getGraphState: vi.fn(() => ({
      computedThreshold: 20,
      currentThreshold: 20,
      lastBranchPoint: 4,
      totalBeats: 10,
      longestReach: 0,
      allEdges: [edgeA, edgeB],
    })),
    deleteEdge: vi.fn((edge: { deleted: boolean }) => {
      edge.deleted = true;
    }),
    setUserAnchorEdge: vi.fn(),
  };
}

describe("cast tuning", () => {
  it("parses supported fields including booleans, highlight, and audio mode", () => {
    const parsed = parseCastTuningParams(
      "jb=1&lg=0&sq=0&thresh=31&bp=10,20,30&d=1,3&ah=1&am=eight_d&ab=7",
      makeDefaults(),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.config.justBackwards).toBe(true);
    expect(parsed?.config.justLongBranches).toBe(false);
    expect(parsed?.config.removeSequentialBranches).toBe(true);
    expect(parsed?.config.currentThreshold).toBe(31);
    expect(parsed?.config.randomBranchChanceDelta).toBeCloseTo(0.06, 6);
    expect(parsed?.deletedEdgeIds).toEqual([1, 3]);
    expect(parsed?.anchorBranchId).toBe(7);
    expect(parsed?.highlightAnchorBranch).toBe(true);
    expect(parsed?.audioMode).toBe("eight_d");
    expect(parsed?.hasAudioModeParam).toBe(true);
    expect(parsed?.hasGraphTuning).toBe(true);
  });

  it("ignores threshold values below cast minimum", () => {
    const defaults = makeDefaults();
    const parsed = parseCastTuningParams("thresh=0&jb=1", defaults);
    expect(parsed?.config.currentThreshold).toBe(defaults.currentThreshold);
  });

  it("parses sequential toggle aliases", () => {
    const defaults = makeDefaults();
    const parsedTrue = parseCastTuningParams("sq=true", defaults);
    const parsedFalse = parseCastTuningParams("sq=false", defaults);
    expect(parsedTrue?.config.removeSequentialBranches).toBe(true);
    expect(parsedFalse?.config.removeSequentialBranches).toBe(false);
  });

  it("treats boolean fields case-insensitively", () => {
    const parsed = parseCastTuningParams("jb=TRUE&lg=FaLsE&ah=TrUe", makeDefaults());
    expect(parsed?.config.justBackwards).toBe(true);
    expect(parsed?.config.justLongBranches).toBe(false);
    expect(parsed?.highlightAnchorBranch).toBe(true);
  });

  it("clamps branch-probability percents", () => {
    const parsed = parseCastTuningParams("bp=-10,130,450", makeDefaults());
    expect(parsed?.config.minRandomBranchChance).toBeCloseTo(0, 6);
    expect(parsed?.config.maxRandomBranchChance).toBeCloseTo(1, 6);
    expect(parsed?.config.randomBranchChanceDelta).toBeCloseTo(0.2, 6);
  });

  it("ignores malformed bp triplets", () => {
    const defaults = makeDefaults();
    const parsed = parseCastTuningParams("bp=20,30", defaults);
    expect(parsed?.config.minRandomBranchChance).toBe(defaults.minRandomBranchChance);
    expect(parsed?.config.maxRandomBranchChance).toBe(defaults.maxRandomBranchChance);
    expect(parsed?.config.randomBranchChanceDelta).toBe(defaults.randomBranchChanceDelta);
  });

  it("filters invalid deleted edge ids", () => {
    const parsed = parseCastTuningParams("d=4,-1,foo,6", makeDefaults());
    expect(parsed?.deletedEdgeIds).toEqual([4, 6]);
  });

  it("parses valid anchor branch ids", () => {
    const parsed = parseCastTuningParams("ab=4", makeDefaults());
    expect(parsed?.anchorBranchId).toBe(4);
    expect(parsed?.hasGraphTuning).toBe(true);
  });

  it("returns null when no tuning keys are present", () => {
    expect(parseCastTuningParams("foo=bar", makeDefaults())).toBeNull();
  });

  it("parses audio-only payloads without graph tuning", () => {
    const parsed = parseCastTuningParams("am=vaporwave", makeDefaults());
    expect(parsed).not.toBeNull();
    expect(parsed?.audioMode).toBe("vaporwave");
    expect(parsed?.hasAudioModeParam).toBe(true);
    expect(parsed?.hasGraphTuning).toBe(false);
  });

  it("parses cast-supported extras audio modes", () => {
    expect(parseCastTuningParams("am=underwater", makeDefaults())?.audioMode).toBe(
      "underwater",
    );
    expect(parseCastTuningParams("am=cathedral", makeDefaults())?.audioMode).toBe(
      "cathedral",
    );
    expect(parseCastTuningParams("am=cowbell", makeDefaults())?.audioMode).toBe(
      "cowbell",
    );
  });

  it("parses every advertised cast audio mode", () => {
    for (const mode of CAST_AUDIO_MODE_CAPABILITIES) {
      expect(parseCastTuningParams(`am=${mode.wireValue}`, makeDefaults())?.audioMode)
        .toBe(mode.wireValue);
    }
    expect(CAST_AUDIO_MODE_CAPABILITIES).toContainEqual({
      wireValue: "cowbell",
      label: "More Cowbell",
    });
  });

  it("parses off case-insensitively for sender payload tolerance", () => {
    expect(parseCastTuningParams("am=Off", makeDefaults())?.audioMode).toBe("off");
  });

  it("ignores unsupported audio mode values", () => {
    const parsed = parseCastTuningParams("am=chipmunk", makeDefaults());
    expect(parsed).not.toBeNull();
    expect(parsed?.audioMode).toBeNull();
    expect(parsed?.hasAudioModeParam).toBe(true);
    expect(parsed?.hasGraphTuning).toBe(false);
  });

  it("does not support eight-bit on cast", () => {
    const parsed = parseCastTuningParams("am=eight_bit", makeDefaults());
    expect(parsed).not.toBeNull();
    expect(parsed?.audioMode).toBeNull();
    expect(parsed?.hasAudioModeParam).toBe(true);
    expect(parsed?.hasGraphTuning).toBe(false);
  });

  it("applies defaults and graph rebuild for highlight-only payloads", () => {
    const engine = makeEngine();
    const result = applyCastTuningToEngine(engine, makeDefaults(), "ah=1");
    expect(result.highlightOnly).toBe(false);
    expect(result.highlightAnchorBranch).toBe(true);
    expect(engine.updateConfig).toHaveBeenCalledTimes(2);
    expect(engine.clearDeletedEdges).toHaveBeenCalledTimes(1);
    expect(engine.rebuildGraph).toHaveBeenCalledTimes(1);
  });

  it("treats ah=0 payload as a full reset with highlight disabled", () => {
    const engine = makeEngine();
    const result = applyCastTuningToEngine(engine, makeDefaults(), "ah=0");
    expect(result.highlightOnly).toBe(false);
    expect(result.highlightAnchorBranch).toBe(false);
    expect(engine.updateConfig).toHaveBeenCalledTimes(2);
    expect(engine.clearDeletedEdges).toHaveBeenCalledTimes(1);
    expect(engine.rebuildGraph).toHaveBeenCalledTimes(1);
  });

  it("applies graph defaults for audio-only payloads", () => {
    const engine = makeEngine();
    const result = applyCastTuningToEngine(engine, makeDefaults(), "am=vaporwave");
    expect(result.highlightOnly).toBe(false);
    expect(result.parsed?.audioMode).toBe("vaporwave");
    expect(engine.updateConfig).toHaveBeenCalledTimes(2);
    expect(engine.clearDeletedEdges).toHaveBeenCalledTimes(1);
    expect(engine.rebuildGraph).toHaveBeenCalledTimes(1);
  });

  it("resets graph tuning when toggling highlight without other params", () => {
    const engine = makeEngine();
    const defaults = makeDefaults();
    applyCastTuningToEngine(engine, defaults, "jb=1&thresh=33&ah=1");
    vi.mocked(engine.updateConfig).mockClear();
    vi.mocked(engine.clearDeletedEdges).mockClear();
    vi.mocked(engine.rebuildGraph).mockClear();
    vi.mocked(engine.deleteEdge).mockClear();

    const result = applyCastTuningToEngine(engine, defaults, "ah=0");
    expect(result.highlightOnly).toBe(false);
    expect(result.highlightAnchorBranch).toBe(false);
    expect(engine.updateConfig).toHaveBeenCalledTimes(2);
    expect(engine.clearDeletedEdges).toHaveBeenCalledTimes(1);
    expect(engine.rebuildGraph).toHaveBeenCalledTimes(1);
    expect(engine.deleteEdge).not.toHaveBeenCalled();
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

  it("applies backward anchor branch ids after graph tuning", () => {
    const engine = makeEngine();
    const result = applyCastTuningToEngine(engine, makeDefaults(), "ab=1");
    expect(result.parsed?.anchorBranchId).toBe(1);
    expect(engine.setUserAnchorEdge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it("ignores forward or deleted anchor branch ids", () => {
    const forwardEngine = makeEngine();
    applyCastTuningToEngine(forwardEngine, makeDefaults(), "ab=2");
    expect(forwardEngine.setUserAnchorEdge).not.toHaveBeenCalled();

    const deletedEngine = makeEngine();
    applyCastTuningToEngine(deletedEngine, makeDefaults(), "d=1&ab=1");
    expect(deletedEngine.deleteEdge).toHaveBeenCalledTimes(1);
    expect(deletedEngine.setUserAnchorEdge).not.toHaveBeenCalled();
  });

  it("resets to defaults when no cast tuning params are provided", () => {
    const engine = makeEngine();
    const defaults = makeDefaults();
    const result = applyCastTuningToEngine(engine, defaults, null);
    expect(result.parsed).toBeNull();
    expect(result.highlightOnly).toBe(false);
    expect(result.highlightAnchorBranch).toBe(false);
    expect(engine.updateConfig).toHaveBeenCalledTimes(1);
    expect(engine.updateConfig).toHaveBeenCalledWith(defaults);
    expect(engine.clearDeletedEdges).toHaveBeenCalledTimes(1);
    expect(engine.rebuildGraph).toHaveBeenCalledTimes(1);
    expect(engine.deleteEdge).not.toHaveBeenCalled();
  });
});
