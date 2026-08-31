import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAppStore } from "./store";
import type { AppContext } from "./context";
import type { JukeboxConfig } from "@forever-jukebox/shared/types";
import {
  applyTuningParamsToEngine,
  canonicalizeTuningParams,
  clearTuningParamsFromUrl,
  getAnchorBranchIdFromUrl,
  getDeletedEdgeIdsFromUrl,
  getTuningParamsFromEngine,
  savedTuningParamsEquivalent,
  serializeParams,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "./tuning";
import { setWindowUrl } from "./__tests__/test-utils";

function createConfig(overrides: Partial<JukeboxConfig> = {}): JukeboxConfig {
  return {
    maxBranches: 4,
    maxBranchThreshold: 80,
    currentThreshold: 0,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.02,
    minLongBranch: 0,
    minLongBranchPercent: 20,
    ...overrides,
  };
}

function createContext(
  configOverrides: Partial<JukeboxConfig> = {},
  defaultOverrides: Partial<JukeboxConfig> = {},
): AppContext {
  let config = createConfig(configOverrides);
  const defaultConfig = createConfig(defaultOverrides);
  const engine = {
    getConfig: () => ({ ...config }),
    updateConfig: (partial: Partial<JukeboxConfig>) => {
      config = { ...config, ...partial };
    },
    getGraphState: () => null,
    getUserAnchorEdgeId: () => null,
  };
  return {
    defaultConfig,
    engine: engine as unknown as AppContext["engine"],
    player: {
      setJukeboxAudioMode: vi.fn(),
      setJukeboxAudioModeIntensity: vi.fn(),
    } as unknown as AppContext["player"],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    cowbellOverlay: {
      enable: vi.fn(),
      disable: vi.fn(),
    } as unknown as AppContext["cowbellOverlay"],
  };
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
});

describe("tuning params", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/listen/abc");
  });

  it("applies tuning params to engine config", () => {
    const context = createContext();
    const params = new URLSearchParams(
      "jb=1&lg=1&sq=0&thresh=25&bp=18,50,10&am=nightcore",
    );
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    const config = context.engine.getConfig();
    expect(config.justBackwards).toBe(true);
    expect(config.justLongBranches).toBe(true);
    expect(config.minLongBranchPercent).toBe(20);
    expect(config.removeSequentialBranches).toBe(true);
    expect(config.currentThreshold).toBe(25);
    expect(config.minRandomBranchChance).toBeCloseTo(0.18, 4);
    expect(config.maxRandomBranchChance).toBeCloseTo(0.5, 4);
    expect(config.randomBranchChanceDelta).toBeCloseTo(0.02, 4);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("nightcore");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "nightcore",
      100,
    );
  });

  it("applies minimum jump distance percentages from params", () => {
    const context = createContext();
    applyTuningParamsToEngine(context, new URLSearchParams("bl=30"));
    expect(context.engine.getConfig()).toEqual(
      expect.objectContaining({
        justLongBranches: true,
        minLongBranchPercent: 30,
      }),
    );
  });

  it("falls back to 20% for legacy and malformed long-branch params", () => {
    const legacy = createContext();
    applyTuningParamsToEngine(legacy, new URLSearchParams("lg=1"));
    expect(legacy.engine.getConfig().minLongBranchPercent).toBe(20);

    const malformed = createContext();
    applyTuningParamsToEngine(
      malformed,
      new URLSearchParams("lg=1&bl=25"),
    );
    expect(malformed.engine.getConfig()).toEqual(
      expect.objectContaining({
        justLongBranches: true,
        minLongBranchPercent: 20,
      }),
    );
  });

  it("ignores unsupported audio mode values", () => {
    const context = createContext();
    const params = new URLSearchParams("am=chipmunk");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("off");
    expect(context.player.setJukeboxAudioMode).not.toHaveBeenCalled();
  });

  it("applies eight-bit audio mode from params", () => {
    const context = createContext();
    const params = new URLSearchParams("am=eight_bit");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("eight_bit");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "eight_bit",
      100,
    );
  });

  it("applies underwater audio mode from params", () => {
    const context = createContext();
    const params = new URLSearchParams("am=underwater");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("underwater");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "underwater",
      100,
    );
  });

  it("applies cathedral audio mode from params", () => {
    const context = createContext();
    const params = new URLSearchParams("am=cathedral");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("cathedral");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "cathedral",
      100,
    );
  });

  it("applies cowbell audio mode from params", () => {
    const context = createContext();
    const params = new URLSearchParams("am=cowbell");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("cowbell");
    expect(context.cowbellOverlay.enable).toHaveBeenCalledTimes(1);
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "cowbell",
      100,
    );
  });

  it("records audio mode without arming the player outside jukebox mode", () => {
    useAppStore.setState({ playMode: "autocanonizer" });
    const context = createContext();
    const params = new URLSearchParams("am=nightcore&ai=130");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("nightcore");
    expect(useAppStore.getState().audioIntensity).toBe(130);
    expect(context.player.setJukeboxAudioMode).not.toHaveBeenCalled();
  });

  it("does not enable the cowbell overlay outside jukebox mode", () => {
    useAppStore.setState({ playMode: "autocanonizer" });
    const context = createContext();
    const applied = applyTuningParamsToEngine(
      context,
      new URLSearchParams("am=cowbell"),
    );
    expect(applied).toBe(true);
    expect(context.cowbellOverlay.enable).not.toHaveBeenCalled();
    expect(context.cowbellOverlay.disable).toHaveBeenCalledTimes(1);
    expect(context.player.setJukeboxAudioMode).not.toHaveBeenCalled();
  });

  it("applies audio intensity with a supported mode", () => {
    const context = createContext();
    const params = new URLSearchParams("am=nightcore&ai=130");
    const applied = applyTuningParamsToEngine(context, params);
    expect(applied).toBe(true);
    expect(useAppStore.getState().audioIntensity).toBe(130);
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "nightcore",
      130,
    );
  });

  it("clamps out-of-range audio intensity values", () => {
    const context = createContext();
    applyTuningParamsToEngine(context, new URLSearchParams("am=daycore&ai=400"));
    expect(useAppStore.getState().audioIntensity).toBe(150);
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "daycore",
      150,
    );
  });

  it("defaults audio intensity for unsupported modes and malformed values", () => {
    const unsupported = createContext();
    applyTuningParamsToEngine(unsupported, new URLSearchParams("am=lofi&ai=130"));
    expect(useAppStore.getState().audioIntensity).toBe(100);
    expect(unsupported.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "lofi",
      100,
    );

    const malformed = createContext();
    applyTuningParamsToEngine(malformed, new URLSearchParams("am=nightcore&ai=loud"));
    expect(useAppStore.getState().audioIntensity).toBe(100);
    expect(malformed.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "nightcore",
      100,
    );
  });

  it("serializes audio intensity only for supported modes at non-default values", () => {
    const context = createContext();
    useAppStore.setState({ jukeboxAudioMode: "nightcore", audioIntensity: 130 });
    expect(getTuningParamsFromEngine(context).get("ai")).toBe("130");

    useAppStore.setState({ audioIntensity: 100 });
    expect(getTuningParamsFromEngine(context).get("ai")).toBeNull();

    useAppStore.setState({ jukeboxAudioMode: "lofi", audioIntensity: 130 });
    expect(getTuningParamsFromEngine(context).get("ai")).toBeNull();
  });

  it("serializes only non-default tuning params", () => {
    const context = createContext({
      justBackwards: true,
      currentThreshold: 30,
    });
    const params = getTuningParamsFromEngine(context);
    expect(params.get("jb")).toBe("1");
    expect(params.get("thresh")).toBe("30");
    expect(params.get("bp")).toBeNull();
  });

  it("serializes minimum jump distance without the legacy long-branch flag", () => {
    const context = createContext({
      justLongBranches: true,
      minLongBranchPercent: 10,
    });
    const params = getTuningParamsFromEngine(context);
    expect(params.get("lg")).toBeNull();
    expect(params.get("bl")).toBe("10");
  });

  it("serializes audio mode when enabled", () => {
    const context = createContext();
    useAppStore.setState({ jukeboxAudioMode: "cowbell" });
    const params = getTuningParamsFromEngine(context);
    expect(params.get("am")).toBe("cowbell");
  });

  it("serializes deleted edge ids when present", () => {
    const context = createContext();
    const graph = {
      allEdges: [
        { id: 1, deleted: true },
        { id: 2, deleted: false },
        { id: 5, deleted: true },
      ],
    };
    (context.engine as { getGraphState: () => unknown }).getGraphState =
      () => graph;
    const params = getTuningParamsFromEngine(context);
    expect(params.get("d")).toBe("1,5");
  });

  it("serializes user anchor branch id when present", () => {
    const context = createContext();
    (context.engine as { getUserAnchorEdgeId: () => number | null }).getUserAnchorEdgeId =
      () => 7;
    const params = getTuningParamsFromEngine(context);
    expect(params.get("ab")).toBe("7");
  });

  it("parses deleted edge ids from url", () => {
    setWindowUrl("http://localhost/listen/abc?d=3,5,notanumber,7");
    expect(getDeletedEdgeIdsFromUrl()).toEqual([3, 5, 7]);
  });

  it("parses anchor branch id from url", () => {
    setWindowUrl("http://localhost/listen/abc?ab=12");
    expect(getAnchorBranchIdFromUrl()).toBe(12);
  });

  it("syncs tuning params state from engine config", () => {
    const context = createContext({ justBackwards: true });
    const result = syncTuningParamsState(context);
    expect(result).toBe("jb=1");
    expect(useAppStore.getState().tuningParams).toBe("jb=1");
  });

  it("writes and clears tuning params in the URL", () => {
    setWindowUrl("http://localhost/listen/abc?foo=bar");
    writeTuningParamsToUrl("jb=1&thresh=20&bp=25,50,10&am=nightcore", true);
    expect(window.location.search).toContain("foo=bar");
    expect(window.location.search).toContain("jb=1");
    expect(window.location.search).toContain("thresh=20");
    expect(window.location.search).toContain("bp=25,50,10");
    expect(window.location.search).toContain("am=nightcore");

    clearTuningParamsFromUrl(true);
    expect(window.location.search).toContain("foo=bar");
    expect(window.location.search).not.toContain("jb=1");
    expect(window.location.search).not.toContain("thresh=20");
    expect(window.location.search).not.toContain("am=nightcore");
  });

  it("ignores malformed bp values", () => {
    const context = createContext();
    const params = new URLSearchParams("bp=abc,def,ghi");
    applyTuningParamsToEngine(context, params);
    const config = context.engine.getConfig();
    expect(config.minRandomBranchChance).toBeCloseTo(0.18, 4);
    expect(config.maxRandomBranchChance).toBeCloseTo(0.5, 4);
    expect(config.randomBranchChanceDelta).toBeCloseTo(0.02, 4);
  });

  it("ignores negative threshold values", () => {
    const context = createContext();
    const params = new URLSearchParams("thresh=-10");
    applyTuningParamsToEngine(context, params);
    const config = context.engine.getConfig();
    expect(config.currentThreshold).toBe(0);
  });

  it("handles partially malformed bp values", () => {
    const context = createContext();
    const params = new URLSearchParams("bp=25,,10");
    applyTuningParamsToEngine(context, params);
    const config = context.engine.getConfig();
    expect(config.minRandomBranchChance).toBeCloseTo(0.25, 4);
    expect(config.maxRandomBranchChance).toBeCloseTo(0.5, 4);
    expect(config.randomBranchChanceDelta).toBeCloseTo(0.02, 4);
  });
});

// The param string is the only tuning artefact that outlives the session: it is
// stored verbatim on favorites and playlist entries and pasted into share links.
// These assert what a given string reads back as, never how it is held.
describe("threshold param round trip", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/listen/abc");
  });

  function readBack(raw: string) {
    const context = createContext();
    applyTuningParamsToEngine(context, new URLSearchParams(raw));
    return serializeParams(getTuningParamsFromEngine(context));
  }

  function thresholdOf(raw: string) {
    return new URLSearchParams(readBack(raw)).get("thresh");
  }

  const cases: Array<[string, string | null]> = [
    ["thresh=45", "45"],
    ["thresh=2", "2"],
    ["thresh=80", "80"],
    ["jb=1", null],
    ["thresh=0", null],
    ["thresh=-10", null],
    ["thresh=abc", null],
  ];

  for (const [raw, expected] of cases) {
    it(`reads "${raw}" as ${expected === null ? "no threshold" : expected}`, () => {
      expect(thresholdOf(raw)).toBe(expected);
    });
  }

  it("reads a threshold below the slider floor as auto", () => {
    expect(thresholdOf("thresh=1")).toBeNull();
  });

  it("clamps a threshold above the ceiling to the value that acts", () => {
    expect(thresholdOf("thresh=500")).toBe("80");
  });

  it("keeps a threshold distinct from the params beside it", () => {
    expect(readBack("jb=1&thresh=45&bp=25,60,10")).toBe(
      "jb=1&thresh=45&bp=25,60,10",
    );
  });

  it("reads a threshold the same regardless of key order", () => {
    expect(thresholdOf("bp=25,60,10&thresh=45&jb=1")).toBe("45");
  });

  it("settles after one read", () => {
    for (const [raw] of cases) {
      const once = readBack(raw);
      expect(readBack(once)).toBe(once);
    }
  });
});

// Canonicalization equates stored strings that spell the same tuning
// differently (other clients, older versions, hand-edited share links).
describe("canonical tuning params", () => {
  const defaults = createConfig();
  const canon = (raw: string | null) => canonicalizeTuningParams(raw, defaults);
  const equiv = (a: string | null, b: string | null) =>
    savedTuningParamsEquivalent(a, b, defaults);

  it("normalizes key order", () => {
    expect(canon("thresh=45&jb=1")).toBe("jb=1&thresh=45");
    expect(equiv("thresh=45&jb=1", "jb=1&thresh=45")).toBe(true);
  });

  it("equates legacy lg with its bl default", () => {
    expect(equiv("lg=1", "bl=20")).toBe(true);
  });

  it("collapses explicitly written defaults to null", () => {
    expect(canon("bp=18,50,10")).toBeNull();
    expect(canon("thresh=0")).toBeNull();
    expect(canon("am=off")).toBeNull();
    expect(canon("sq=1")).toBeNull();
  });

  it("drops a default audio intensity", () => {
    expect(equiv("am=nightcore&ai=100", "am=nightcore")).toBe(true);
  });

  it("decodes escaped commas", () => {
    expect(equiv("bp=25%2C60%2C10", "bp=25,60,10")).toBe(true);
    expect(canon("d=4%2C2")).toBe("d=2,4");
  });

  it("strips ah and unknown keys", () => {
    expect(equiv("jb=1&ah=1", "jb=1")).toBe(true);
    expect(equiv("jb=1&foo=bar", "jb=1")).toBe(true);
  });

  it("sorts and dedupes deleted edge ids", () => {
    expect(canon("d=5,3,3")).toBe("d=3,5");
    expect(equiv("d=5,3", "d=3,5")).toBe(true);
  });

  it("treats null, empty, and whitespace alike", () => {
    expect(canon(null)).toBeNull();
    expect(canon("")).toBeNull();
    expect(canon("   ")).toBeNull();
    expect(equiv(null, "")).toBe(true);
    expect(equiv(null, "am=off")).toBe(true);
  });

  it("keeps every integer branch-probability percent intact", () => {
    for (let pct = 0; pct <= 100; pct += 1) {
      const raw = `bp=${pct},${pct},${pct}`;
      const once = canon(raw);
      expect(once).toBe(raw);
      expect(canon(once)).toBe(once);
    }
  });

  it("is a fixpoint for the live builder's output", () => {
    const context = createContext();
    applyTuningParamsToEngine(
      context,
      new URLSearchParams("jb=1&sq=0&thresh=45&bp=25,60,10&am=nightcore&ai=60"),
    );
    const live = serializeParams(getTuningParamsFromEngine(context));
    expect(canon(live)).toBe(live);
  });
});
