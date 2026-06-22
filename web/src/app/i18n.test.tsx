import { describe, expect, it } from "vitest";
import i18n from "./i18n";

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
  });
});
