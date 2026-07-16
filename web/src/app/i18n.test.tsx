import { describe, expect, it } from "vitest";
import i18n, {
  resolveSupportedLanguage,
  supportedLanguageOptions,
} from "./i18n";

describe("web i18n bootstrap", () => {
  it("loads English synchronously and updates the document language", () => {
    expect(i18n.t("navigation.topTracks")).toBe("Top Tracks");
    expect(document.documentElement.lang).toBe("en");
  });

  it("supports interpolation, pluralization, and English fallback", async () => {
    expect(i18n.t("playback.branchStatsTitle", { id: 12 })).toBe(
      "Branch #12 stats",
    );
    expect(i18n.t("sleepTimer.minutes", { count: 1 })).toBe("1 minute");
    expect(i18n.t("sleepTimer.minutes", { count: 15 })).toBe("15 minutes");

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
      { code: "es", label: "Español" },
    ]);
    expect(resolveSupportedLanguage("en-US")).toBe("en");
    expect(resolveSupportedLanguage("de-DE")).toBe("de");
    expect(resolveSupportedLanguage("es-MX")).toBe("es");
    expect(resolveSupportedLanguage("invalid")).toBe("en");
  });

  it("sets document text direction on bootstrap", () => {
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("resolves the translation credit from the locale file", () => {
    expect(i18n.getFixedT("en")("translationByNameCredit")).toBe("");
    expect(i18n.getFixedT("es")("translationByNameCredit")).toBe(
      "Traducido por Pablo",
    );
    expect(i18n.getFixedT("de")("translationByNameCredit")).toBe(
      "Übersetzung von floriegl",
    );
  });
});
