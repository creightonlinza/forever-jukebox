import { expect, test } from "@playwright/test";
import { loadFirstTopTrack } from "./helpers";

test.describe("Settings modal", () => {
  test("cached-audio button reflects IndexedDB contents and clears them", async ({
    page,
  }) => {
    // fresh profile: nothing cached yet
    await page.goto("/");
    await page.locator("#settings-open").click();
    const button = page.locator("#cached-audio-clear");
    await expect(button).toHaveText("Clear 0MB");
    await expect(button).toBeDisabled();
    await page.locator("#settings-close").click();

    // load a track (caches its audio), then reopen settings
    const trackId = await loadFirstTopTrack(page);
    expect(trackId).toBeTruthy();
    await page.locator("#settings-open").click();
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
