import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveStoredBranchStatsEnabled,
  storeBranchStatsEnabled,
} from "./extrasMode";

function setLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
  return store;
}

describe("branch stats preference", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  it("defaults to disabled when storage is empty", () => {
    expect(resolveStoredBranchStatsEnabled()).toBe(false);
  });

  it("persists and reads enabled state", () => {
    storeBranchStatsEnabled(true);
    expect(localStorage.getItem("fj-branch-stats-enabled")).toBe("1");
    expect(resolveStoredBranchStatsEnabled()).toBe(true);
  });

  it("supports legacy true values", () => {
    localStorage.setItem("fj-branch-stats-enabled", "true");
    expect(resolveStoredBranchStatsEnabled()).toBe(true);
  });
});
