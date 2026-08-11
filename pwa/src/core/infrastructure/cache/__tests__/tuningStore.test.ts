import { afterEach, describe, expect, it } from "vitest";
import {
  clearAllTuning,
  loadTuning,
  removeTuning,
  saveTuning,
  type SavedTuning,
} from "../tuningStore";

const sample: SavedTuning = {
  v: 1,
  config: {
    currentThreshold: 42,
    justBackwards: true,
    justLongBranches: false,
    removeSequentialBranches: true,
    minRandomBranchChance: 0.2,
    maxRandomBranchChance: 0.6,
    randomBranchChanceDelta: 0.03,
    minLongBranchPercent: 10,
  },
  deletedEdgeIds: [3, 7, 11],
  anchorEdgeId: 5,
};

afterEach(() => {
  window.localStorage.clear();
});

describe("tuningStore", () => {
  it("round-trips saved tuning by fingerprint", () => {
    saveTuning("fp-1", sample);
    expect(loadTuning("fp-1")).toEqual(sample);
  });

  it("returns null for an unknown fingerprint", () => {
    expect(loadTuning("missing")).toBeNull();
  });

  it("returns null for malformed or wrong-version entries", () => {
    window.localStorage.setItem("fj-tuning:bad-json", "{not json");
    window.localStorage.setItem(
      "fj-tuning:wrong-version",
      JSON.stringify({ ...sample, v: 2 }),
    );
    expect(loadTuning("bad-json")).toBeNull();
    expect(loadTuning("wrong-version")).toBeNull();
  });

  it("removes a single fingerprint's tuning", () => {
    saveTuning("fp-1", sample);
    saveTuning("fp-2", sample);
    removeTuning("fp-1");
    expect(loadTuning("fp-1")).toBeNull();
    expect(loadTuning("fp-2")).toEqual(sample);
  });

  it("preserves valid thresholds across the slider range", () => {
    for (const currentThreshold of [0, 2, 45, 80]) {
      const stored = { ...sample, config: { ...sample.config, currentThreshold } };
      saveTuning("fp-range", stored);
      expect(loadTuning("fp-range")?.config.currentThreshold).toBe(currentThreshold);
    }
  });

  function loadStoredConfig(config: unknown) {
    window.localStorage.setItem(
      "fj-tuning:fp-raw",
      JSON.stringify({ ...sample, config }),
    );
    return loadTuning("fp-raw")?.config;
  }

  const thresholdCases: Array<[unknown, number]> = [
    [null, 0],
    ["45", 45],
    [-1, 0],
    [0, 0],
    [1, 0],
    [500, 80],
    [45.6, 46],
    [undefined, 0],
  ];

  for (const [stored, expected] of thresholdCases) {
    it(`normalizes a stored threshold of ${String(stored)} to ${expected}`, () => {
      const config = loadStoredConfig({ ...sample.config, currentThreshold: stored });
      expect(config?.currentThreshold).toBe(expected);
    });
  }

  it("falls back to engine defaults for non-boolean flags", () => {
    const config = loadStoredConfig({ ...sample.config, justBackwards: "yes" });
    expect(config?.justBackwards).toBe(false);
  });

  it("clamps out-of-range branch probabilities", () => {
    const config = loadStoredConfig({
      ...sample.config,
      minRandomBranchChance: -2,
      maxRandomBranchChance: Number.NaN,
    });
    expect(config?.minRandomBranchChance).toBe(0);
    expect(config?.maxRandomBranchChance).toBeCloseTo(0.5, 4);
  });

  it("reorders branch probabilities when a fallback inverts the pair", () => {
    const config = loadStoredConfig({
      ...sample.config,
      minRandomBranchChance: 0.6,
      maxRandomBranchChance: "high",
    });
    expect(config?.minRandomBranchChance).toBeCloseTo(0.5, 4);
    expect(config?.maxRandomBranchChance).toBeCloseTo(0.6, 4);
  });

  it("falls back to the default minimum jump distance when unusable", () => {
    const config = loadStoredConfig({ ...sample.config, minLongBranchPercent: 0 });
    expect(config?.minLongBranchPercent).toBe(20);
  });

  it("clearAllTuning removes only fj-tuning: keys", () => {
    saveTuning("fp-1", sample);
    saveTuning("fp-2", sample);
    window.localStorage.setItem("fj-viz", "3");
    window.localStorage.setItem("fj-theme", "dark");
    clearAllTuning();
    expect(loadTuning("fp-1")).toBeNull();
    expect(loadTuning("fp-2")).toBeNull();
    expect(window.localStorage.getItem("fj-viz")).toBe("3");
    expect(window.localStorage.getItem("fj-theme")).toBe("dark");
  });
});
