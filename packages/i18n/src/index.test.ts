import { describe, expect, it } from "vitest";
import { createAppI18n, isRtlLanguage } from "./index";

describe("createAppI18n", () => {
  const supportedLanguageOptions = [
    { code: "en", label: "English" },
    { code: "fr", label: "Français" },
  ] as const;

  const app = createAppI18n({
    resources: {
      en: { translation: { greeting: "Hello" } },
      fr: { translation: { greeting: "Bonjour" } },
    },
    supportedLanguageOptions,
  });

  it("initializes synchronously and can translate", () => {
    expect(app.i18n.isInitialized).toBe(true);
    expect(app.i18n.t("greeting")).toBe("Hello");
  });

  it("resolves supported languages, falling back to English", () => {
    expect(app.resolveSupportedLanguage("fr-CA")).toBe("fr");
    expect(app.resolveSupportedLanguage("de")).toBe("en");
    expect(app.resolveSupportedLanguage(null)).toBe("en");
  });

  it("syncs <html lang/dir> on language change", async () => {
    await app.i18n.changeLanguage("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
    await app.i18n.changeLanguage("en");
  });
});

describe("isRtlLanguage", () => {
  it("detects RTL languages regardless of region subtag", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("he-IL")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage(null)).toBe(false);
  });
});
