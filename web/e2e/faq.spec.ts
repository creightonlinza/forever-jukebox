import { expect, test } from "@playwright/test";
import { loadFirstTopTrack } from "./helpers";

test.describe("FAQ panel", () => {
  test("renders content sections and the offline app link", async ({
    page,
  }) => {
    await page.goto("/faq");
    await expect(page.locator("#faq-panel")).toContainText("What the what?");
    await expect(page.locator("#faq-panel")).toContainText(
      "How can I tune the Jukebox?",
    );
    await expect(
      page.locator('#faq-panel a[href="/offline/"]'),
    ).toBeAttached();
    await expect(page.locator("#faq-whats-new-panel")).toHaveClass(
      /\bhidden\b/,
    );
  });

  test("cached-audio button reflects IndexedDB contents and clears them", async ({
    page,
  }) => {
    // fresh profile: nothing cached yet
    await page.goto("/faq");
    const button = page.locator("#cached-audio-clear");
    await expect(button).toHaveText("Clear 0MB");
    await expect(button).toBeDisabled();

    // load a track (caches its audio), then revisit FAQ
    const trackId = await loadFirstTopTrack(page);
    expect(trackId).toBeTruthy();
    await page.locator('[data-tab-button="faq"]').click();
    await expect(button).not.toHaveText("Clear 0MB", { timeout: 15_000 });
    await expect(button).toBeEnabled();

    await button.click();
    await expect(page.locator("#toast")).toContainText(
      "Cached audio cleared.",
    );
    await expect(button).toHaveText("Clear 0MB");
    await expect(button).toBeDisabled();
  });
});
