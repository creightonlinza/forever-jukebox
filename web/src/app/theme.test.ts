import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import { applyStoredTheme, applyTheme, applyThemeVariables, resolveStoredTheme } from "./theme";
import { themeConfig } from "./themeConfig";

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

function createClassList() {
  return {
    toggle: vi.fn(),
  };
}

describe("theme", () => {
  beforeEach(() => {
    setLocalStorage();
    (globalThis as any).document = {
      documentElement: {
        style: { setProperty: vi.fn() },
      },
      body: { classList: createClassList() },
    };
  });

  it("applies theme variables", () => {
    applyThemeVariables("dark");
    const setProperty = document.documentElement.style.setProperty as any;
    const sampleKey = Object.keys(themeConfig.dark)[0];
    expect(setProperty).toHaveBeenCalledWith(
      sampleKey,
      themeConfig.dark[sampleKey],
    );
  });

  it("resolves stored theme with fallback", () => {
    expect(resolveStoredTheme()).toBe("dark");
    localStorage.setItem("fj-theme", "light");
    expect(resolveStoredTheme()).toBe("light");
  });

  it("applies theme updates and persists", () => {
    const refresh = vi.fn();
    const context = {
      jukebox: { refresh } as unknown as AppContext["jukebox"],
    } as unknown as AppContext;
    applyTheme(context, "light");
    expect(document.body.classList.toggle).toHaveBeenCalledWith(
      "theme-light",
      true,
    );
    expect(refresh).toHaveBeenCalled();
    expect(localStorage.getItem("fj-theme")).toBe("light");
  });

  it("applies stored theme", () => {
    localStorage.setItem("fj-theme", "light");
    const context = {
      jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    } as unknown as AppContext;
    applyStoredTheme(context);
    expect(document.body.classList.toggle).toHaveBeenCalledWith(
      "theme-light",
      true,
    );
  });
});
