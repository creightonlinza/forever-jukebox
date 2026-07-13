import { describe, expect, it } from "vitest";
import i18n, {
  resolveSupportedLanguage,
  supportedLanguageOptions,
} from "./i18n";

describe("PWA i18n bootstrap", () => {
  it("loads English synchronously and updates the document language", () => {
    expect(i18n.t("navigation.offlineApp")).toBe("Offline App");
    expect(document.documentElement.lang).toBe("en");
  });

  it("supports interpolation, pluralization, and English fallback", async () => {
    expect(i18n.t("home.deleteNamed", { label: "Song" })).toBe(
      "Delete cached analysis for Song",
    );
    expect(i18n.t("sleepTimer.minutes", { count: 1 })).toBe("1 minute");
    expect(i18n.t("sleepTimer.minutes", { count: 30 })).toBe("30 minutes");

    await i18n.changeLanguage("fr");
    expect(i18n.t("common.listen")).toBe("Listen");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("fj-language")).toBe("en");
  });

  it("exposes an extensible supported-language list", () => {
    expect(supportedLanguageOptions).toEqual([
      { code: "en", label: "English" },
      { code: "de", label: "Deutsch" },
    ]);
    expect(resolveSupportedLanguage("en-US")).toBe("en");
    expect(resolveSupportedLanguage("de-DE")).toBe("de");
    expect(resolveSupportedLanguage("invalid")).toBe("en");
  });

  it("sets document text direction on bootstrap", () => {
    expect(document.documentElement.dir).toBe("ltr");
  });
});
