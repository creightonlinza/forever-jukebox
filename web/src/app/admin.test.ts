import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_KEY_STORAGE_KEY, getAdminKey, isAdminMode } from "./admin";

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
    key: () => null,
    length: 0,
  } as Storage;
}

describe("admin mode", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  it("returns a trimmed admin key from local storage", () => {
    localStorage.setItem(ADMIN_KEY_STORAGE_KEY, "  secret  ");

    expect(getAdminKey()).toBe("secret");
    expect(isAdminMode()).toBe(true);
  });

  it("ignores missing or empty admin keys", () => {
    expect(getAdminKey()).toBeNull();
    localStorage.setItem(ADMIN_KEY_STORAGE_KEY, "   ");

    expect(getAdminKey()).toBeNull();
    expect(isAdminMode()).toBe(false);
  });
});
