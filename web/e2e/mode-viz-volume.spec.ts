import { expect, test } from "@playwright/test";
import { loadFirstTopTrack, setRangeValue } from "./helpers";

test.describe("play mode switching", () => {
  test("autocanonizer round trip: URL, controls, title, params restore", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    // give the track some tuning first
    await page.locator("#tuning").click();
    await setRangeValue(page, "#threshold", "50");
    await page.locator("#tuning-apply").click();
    await expect(page).toHaveURL(/\?thresh=50$/);

    await page.locator("#play-mode-select").selectOption("autocanonizer");
    await expect(page).toHaveURL(/\?mode=autocanonizer$/);
    await expect(page.locator("#tuning")).toHaveClass(/is-hidden/);
    await expect(page.locator("#track-info")).toHaveClass(/is-hidden/);
    await expect(page.locator("#viz-select")).toBeDisabled();
    await expect(page.locator("#jukebox-viz")).toHaveClass(/is-canonizer/);
    await expect(page.locator("#viz-beats-label")).toHaveClass(/is-hidden/);
    await expect(page.locator("#viz-now-playing")).toContainText(
      "(autocanonized)",
    );
    await expect(page.locator(".canonizer-finish")).toBeVisible();

    await page.locator("#play-mode-select").selectOption("jukebox");
    await expect(page).toHaveURL(/\?thresh=50$/); // tuning params restored
    await expect(page.locator("#tuning")).not.toHaveClass(/is-hidden/);
    await expect(page.locator("#viz-now-playing")).not.toContainText(
      "(autocanonized)",
    );
  });

  test("deep link with mode=autocanonizer starts in autocanonizer", async ({
    page,
  }) => {
    const trackId = await loadFirstTopTrack(page);
    await page.goto(`/listen/${trackId}?mode=autocanonizer`);
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
    await expect(page.locator("#play-mode-select")).toHaveValue(
      "autocanonizer",
    );
    await expect(page.locator("#jukebox-viz")).toHaveClass(/is-canonizer/);
  });

  test("canonizer finish-out checkbox persists fj-canonizer-finish", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    const checkbox = page.locator("#canonizer-finish");
    // CSS shows the checkbox only while in autocanonizer mode
    await expect(checkbox).toBeHidden();
    await page.locator("#play-mode-select").selectOption("autocanonizer");
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    expect(
      await page.evaluate(() => localStorage.getItem("fj-canonizer-finish")),
    ).toBe("true");
    await page.reload();
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
    await expect(page.locator("#canonizer-finish")).toBeChecked();
  });
});

test.describe("visualization selector", () => {
  test("sorted options, selection persists to fj-viz and across reload", async ({
    page,
  }) => {
    const trackId = await loadFirstTopTrack(page);
    const select = page.locator("#viz-select");
    await expect(select).toBeEnabled();
    const labels = await select.locator("option").allTextContents();
    expect(labels).toEqual([...labels].sort());
    expect(labels).toContain("Classic");

    await select.selectOption({ label: "Galaxy" });
    expect(await page.evaluate(() => localStorage.getItem("fj-viz"))).toBe(
      "2",
    );

    await page.goto(`/listen/${trackId}`);
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
    await expect(page.locator("#viz-select")).toHaveValue("2");
  });

  test("viz select is disabled before a track loads", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-tab-button="play"]').click();
    await expect(page.locator("#viz-select")).toBeDisabled();
  });
});

test.describe("volume + fullscreen", () => {
  test("volume panel toggles, slider updates label, click-away closes", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    const panel = page.locator("#volume-control-panel");
    await expect(panel).toHaveClass(/is-hidden/);
    await page.locator("#volume-button").click();
    await expect(panel).not.toHaveClass(/is-hidden/);
    await expect(page.locator("#volume-val")).toHaveText("50");

    await setRangeValue(page, "#volume", "75");
    await expect(page.locator("#volume-val")).toHaveText("75");

    // click a static element (the marquee title animates and never settles)
    await page.locator("#listen-time").click();
    await expect(panel).toHaveClass(/is-hidden/);
  });

  test("fullscreen toggle round trip", async ({ page }) => {
    await loadFirstTopTrack(page);
    const button = page.locator("#fullscreen");
    await expect(button).toHaveAttribute("aria-label", "Fullscreen");
    await button.click();
    const entered = await page
      .waitForFunction(() => document.fullscreenElement !== null, undefined, {
        timeout: 5_000,
      })
      .then(() => true)
      .catch(() => false);
    test.skip(!entered, "environment does not support fullscreen");
    await expect(button).toHaveAttribute("aria-label", "Exit Fullscreen");
    await expect(button.locator(".fullscreen-icon")).toHaveText(
      "fullscreen_exit",
    );
    await button.click();
    await expect(button).toHaveAttribute("aria-label", "Fullscreen");
  });
});
