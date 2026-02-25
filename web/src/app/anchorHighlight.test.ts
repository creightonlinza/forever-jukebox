import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveStoredAnchorHighlight,
  storeAnchorHighlight,
} from "./anchorHighlight";

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

describe("anchor highlight preference", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  it("defaults to disabled when storage is empty", () => {
    expect(resolveStoredAnchorHighlight()).toBe(false);
  });

  it("persists and reads enabled state", () => {
    storeAnchorHighlight(true);
    expect(localStorage.getItem("fj-highlight-anchor-branch")).toBe("1");
    expect(resolveStoredAnchorHighlight()).toBe(true);
  });

  it("supports legacy true values", () => {
    localStorage.setItem("fj-highlight-anchor-branch", "true");
    expect(resolveStoredAnchorHighlight()).toBe(true);
  });
});
