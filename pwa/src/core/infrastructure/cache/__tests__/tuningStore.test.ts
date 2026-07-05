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
