import { beforeEach, describe, expect, it } from "vitest";
import { applyStoredTheme, applyTheme, resolveStoredTheme } from "./theme";

describe("PWA theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("resolves the persisted theme with a dark fallback", () => {
    expect(resolveStoredTheme()).toBe("dark");
    localStorage.setItem("fj-theme", "light");
    expect(resolveStoredTheme()).toBe("light");
    localStorage.setItem("fj-theme", "invalid");
    expect(resolveStoredTheme()).toBe("dark");
  });

  it("applies and persists theme variables", () => {
    applyTheme("light");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe(
      "#F6F1FF",
    );
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("fj-theme")).toBe("light");
  });

  it("hydrates the stored theme", () => {
    localStorage.setItem("fj-theme", "light");
    applyStoredTheme();
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
