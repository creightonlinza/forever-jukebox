import { expect, test } from "@playwright/test";
import { loadFirstTopTrack } from "./helpers";

test.describe("playback", () => {
  test("play → pause → resume → stop-on-space lifecycle with counters", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    const play = page.locator("#viz-play");
    await expect(play).toHaveAttribute("aria-label", "Play");

    await play.click();
    await expect(play).toHaveAttribute("aria-label", "Pause");

    // beats count up and listen time ticks
    await expect
      .poll(
        async () =>
          Number(await page.locator("#beats-played").textContent()),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () => page.locator("#listen-time").textContent(), {
        timeout: 15_000,
      })
      .not.toBe("00:00:00");

    // pause via Space (global hotkey, play tab only)
    await page.keyboard.press("Space");
    await expect(play).toHaveAttribute("aria-label", "Resume");

    await page.keyboard.press("Space");
    await expect(play).toHaveAttribute("aria-label", "Pause");

    await play.click();
    await expect(play).toHaveAttribute("aria-label", "Resume");
  });

  test("listen time tracks wall-clock while playing", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#viz-play").click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
    const started = Date.now();
    await page.waitForTimeout(6_000);
    const text = (await page.locator("#listen-time").textContent()) ?? "";
    const [h, m, s] = text.split(":").map(Number);
    const shownSeconds = h * 3600 + m * 60 + s;
    const elapsed = (Date.now() - started) / 1000;
    // generous bounds; flags gross mis-accounting without being flaky
    expect(shownSeconds).toBeGreaterThanOrEqual(Math.floor(elapsed) - 3);
    expect(shownSeconds).toBeLessThanOrEqual(Math.ceil(elapsed) + 3);
  });

  test("play tab pulses while audio runs on other tabs", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#viz-play").click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
    await page.locator('[data-tab-button="top"]').click();
    await expect(page.locator('[data-tab-button="play"]')).toHaveClass(
      /is-playing/,
    );
    await page.locator('[data-tab-button="play"]').click();
    await expect(page.locator('[data-tab-button="play"]')).not.toHaveClass(
      /is-playing/,
    );
  });

  test("Space does nothing when not on the play tab", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator('[data-tab-button="faq"]').click();
    await page.keyboard.press("Space");
    await page.locator('[data-tab-button="play"]').click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Play",
    );
  });

  test("H toggles Bring It Home mode with notes and toast", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await expect(page.locator("#bring-home-label")).toHaveClass(/is-hidden/);
    await page.keyboard.press("h");
    await expect(page.locator("#toast")).toContainText(
      "Bring It Home enabled",
    );
    await expect(page.locator("#bring-home-label")).not.toHaveClass(
      /is-hidden/,
    );
    await expect(
      page.locator("#bring-home-fullscreen-label"),
    ).not.toHaveClass(/is-hidden/);
    await page.keyboard.press("h");
    await expect(page.locator("#toast")).toContainText(
      "Bring It Home disabled",
    );
    await expect(page.locator("#bring-home-label")).toHaveClass(/is-hidden/);
  });

  test("hotkeys are ignored while typing in inputs", async ({ page }) => {
    await loadFirstTopTrack(page);
    // open the playlist-capable search field? Listen panel has none; use
    // the favorites filter after switching tabs — instead verify on the
    // search tab input that Space types a space rather than toggling play.
    await page.locator('[data-tab-button="search"]').click();
    await page.locator("#search-input").fill("");
    await page.locator("#search-input").press("a");
    await page.locator("#search-input").press("Space");
    await expect(page.locator("#search-input")).toHaveValue("a ");
    await page.locator('[data-tab-button="play"]').click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Play",
    );
  });
});
