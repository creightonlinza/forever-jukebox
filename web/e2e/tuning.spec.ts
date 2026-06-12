import { expect, test } from "@playwright/test";
import {
  getFixtureTrack,
  loadFirstTopTrack,
  loadTrackByDeepLink,
  setRangeValue,
} from "./helpers";

test.describe("tuning modal", () => {
  test("opens with engine snapshot, applies threshold to the URL, closes", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    const modal = page.locator("#tuning-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    await expect(page.locator("#tuning-title-text")).toHaveText("Tuning");

    // threshold snapshot equals computed default on a fresh track
    const computed = await page
      .locator("#computed-threshold")
      .textContent();
    await expect(page.locator("#threshold")).toHaveValue(computed!);

    await setRangeValue(page, "#threshold", "55");
    await expect(page.locator("#threshold-val")).toHaveText("55");
    await page.locator("#tuning-apply").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(/\?thresh=55$/);
  });

  test("min/max probability swap normalizes on apply", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    await setRangeValue(page, "#min-prob", "80");
    await setRangeValue(page, "#max-prob", "10");
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(/bp=10,80,10/);
    // reopen: form shows the swapped values
    await page.locator("#tuning").click();
    await expect(page.locator("#min-prob")).toHaveValue("10");
    await expect(page.locator("#max-prob")).toHaveValue("80");
  });

  test("checkbox params serialize to the URL and back", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    await page.locator("#just-backwards").check();
    await page.locator("#remove-seq").check();
    await page.locator("#tuning-apply").click();
    await expect(page).toHaveURL(/jb=1/);
    await expect(page).toHaveURL(/sq=0/);
    await page.locator("#tuning").click();
    await expect(page.locator("#just-backwards")).toBeChecked();
    await expect(page.locator("#remove-seq")).toBeChecked();
  });

  test("reset restores defaults and clears tuning params from the URL", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id, "?jb=1&thresh=50");
    await page.locator("#tuning").click();
    await page.locator("#tuning-reset").click();
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);
    await expect(page).not.toHaveURL(/thresh/);
    await expect(page).not.toHaveURL(/jb=1/);
  });

  test("backdrop click closes; Escape does NOT (legacy parity)", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    const modal = page.locator("#tuning-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    // KNOWN BEHAVIOR: unlike the playlist/delete modals, the tuning modal
    // has never closed on Escape. Pinned deliberately — see e2e notes.
    await page.keyboard.press("Escape");
    await expect(modal).toHaveClass(/\bopen\b/);
    await modal.click({ position: { x: 5, y: 5 } });
    await expect(modal).not.toHaveClass(/\bopen\b/);
  });

  test("highlight-anchor checkbox persists to localStorage", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    await page.locator("#highlight-anchor-branch").check();
    await page.locator("#tuning-apply").click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("fj-highlight-anchor-branch"),
      ),
    ).toBe("1");
  });
});

test.describe("extras", () => {
  test("E hotkey opens the extras tab; audio mode applies suffix + am param", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.keyboard.press("e");
    await expect(page.locator("#tuning-modal")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#tuning-title-text")).toHaveText("Extras");
    await expect(page.locator("#tuning-panel-extras")).toBeVisible();

    await page.locator("#audio-mode-nightcore").check();
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(/am=nightcore/);
    await expect(page.locator("#play-title")).toContainText("(nightcore)");
    await expect(page.locator("#viz-now-playing")).toContainText(
      "(nightcore)",
    );
  });

  test("tab toggle switches between Tuning and Extras headers", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    await expect(page.locator("#tuning-tab-toggle-label")).toHaveText(
      "Extras",
    );
    await page.locator("#tuning-tab-toggle").click();
    await expect(page.locator("#tuning-title-text")).toHaveText("Extras");
    await expect(page.locator("#tuning-tab-toggle-label")).toHaveText(
      "Tuning",
    );
    await expect(page.locator("#tuning-title")).toHaveClass(
      /is-extras-active/,
    );
    await page.locator("#tuning-tab-toggle").click();
    await expect(page.locator("#tuning-title-text")).toHaveText("Tuning");
  });

  test("extras reset turns audio mode off and strips am from the URL", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id, "?am=daycore");
    await expect(page.locator("#viz-now-playing")).toContainText("(daycore)");
    await page.keyboard.press("e");
    await page.locator("#tuning-reset").click();
    await expect(page.locator("#tuning-modal")).not.toHaveClass(/\bopen\b/);
    await expect(page).not.toHaveURL(/am=/);
    await expect(page.locator("#viz-now-playing")).not.toContainText(
      "(daycore)",
    );
  });

  test("branch stats toggle persists fj-branch-stats-enabled", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.keyboard.press("e");
    await page.locator("#extras-enabled").check();
    await page.locator("#tuning-apply").click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("fj-branch-stats-enabled"),
      ),
    ).toBe("1");
  });
});

test.describe("sleep timer", () => {
  test("set, live countdown, select round-trip, off", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    await page.locator("#sleep-timer-open").click();
    const modal = page.locator("#sleep-timer-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    await expect(page.locator("#sleep-timer-current")).toHaveText("Off");

    await page.locator("#sleep-timer-select").selectOption("900000");
    await page.locator("#sleep-timer-set").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);

    // reopen: countdown is live and the select reflects the applied timer
    await page.locator("#sleep-timer-open").click();
    await expect(page.locator("#sleep-timer-current")).toContainText(
      "Current countdown: 00:14:",
    );
    await expect(page.locator("#sleep-timer-select")).toHaveValue("900000");

    await page.locator("#sleep-timer-select").selectOption("off");
    await page.locator("#sleep-timer-set").click();
    await page.locator("#sleep-timer-open").click();
    await expect(page.locator("#sleep-timer-current")).toHaveText("Off");
    await page.locator("#sleep-timer-cancel").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);
  });

  test("Close discards a pending selection without applying it", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    await page.locator("#tuning").click();
    await page.locator("#sleep-timer-open").click();
    await page.locator("#sleep-timer-select").selectOption("1800000");
    await page.locator("#sleep-timer-close").click();
    await page.locator("#sleep-timer-open").click();
    await expect(page.locator("#sleep-timer-current")).toHaveText("Off");
    await expect(page.locator("#sleep-timer-select")).toHaveValue("off");
  });
});
