import { expect, test } from "@playwright/test";
import {
  getFixtureTrack,
  getSecondFixtureTrack,
  loadFirstTopTrack,
  waitForTrackLoaded,
} from "./helpers";

// Pins the race-sensitive load/poll/timer lifecycles ahead of the planned
// playback.ts decomposition. In-progress and failed analysis states are
// simulated by mocking /api/analysis/{id} for a real, completed fixture
// track — audio and the eventual completed payload come from the real
// backend.

const POLL_INTERVAL_MS = 3_000; // ANALYSIS_POLL_INTERVAL_MS

test.describe("analysis poll lifecycle", () => {
  test("in-progress analysis shows progress, preloads audio, then completes", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    let analysisHits = 0;
    let audioHits = 0;
    let audioHitsWhenCompleted = -1;
    await page.route(`**/api/audio/${track.id}`, (route) => {
      audioHits += 1;
      return route.continue();
    });
    await page.route(`**/api/analysis/${track.id}`, (route) => {
      analysisHits += 1;
      if (analysisHits <= 2) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: track.id,
            status: "processing",
            progress: 42,
            message: "Analyzing beats",
          }),
        });
      }
      audioHitsWhenCompleted = audioHits;
      return route.continue();
    });

    await page.goto(`/listen/${track.id}`);
    // #analysis-status is a localized label derived from status+progress
    // (see translateJobProgress), not the raw API `message`.
    await expect(page.locator("#analysis-status")).toHaveText("Analyzing");
    await expect(page.locator("#analysis-progress")).toHaveText("42%");
    await expect(page.locator("#analysis-spinner")).not.toHaveClass(
      /\bhidden\b/,
    );

    // the poll keeps going and picks up the (real) completed analysis
    await waitForTrackLoaded(page);
    expect(analysisHits).toBeGreaterThan(2);
    // audio was preloaded while the analysis was still processing
    expect(audioHitsWhenCompleted).toBeGreaterThan(0);
  });

  test("failed analysis surfaces its error and stops polling", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    let analysisHits = 0;
    await page.route(`**/api/analysis/${track.id}`, (route) => {
      analysisHits += 1;
      if (analysisHits === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: track.id, status: "queued" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: track.id,
          status: "failed",
          error: "Beat detection exploded",
          error_code: "analysis_error",
        }),
      });
    });

    await page.goto(`/listen/${track.id}`);
    await expect(page.locator("#analysis-status")).toHaveText(
      "Beat detection exploded",
      { timeout: 20_000 },
    );
    await expect(page.locator("#analysis-spinner")).toHaveClass(/\bhidden\b/);
    await expect(page.locator("#viz-panel")).toHaveClass(/\bhidden\b/);

    // polling must stop after a terminal failure. A superseded load (e.g. a
    // StrictMode double-mount or rapid re-route) can leave one already-issued
    // poll request in flight when the failure renders; its abort cancels future
    // polls but not the in-flight fetch, which can land arbitrarily late under
    // parallel-suite load. Wait until the count holds still for a full poll
    // interval before snapshotting so we measure whether polling *continues*,
    // not the boundary request. A poll that actually keeps going never
    // stabilizes here and still fails the final assertion below.
    let hitsAtFailure = analysisHits;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.waitForTimeout(POLL_INTERVAL_MS + 500);
      if (analysisHits === hitsAtFailure) break;
      hitsAtFailure = analysisHits;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS * 2 + 1_000);
    expect(analysisHits).toBe(hitsAtFailure);
  });

  test("loading another track mid-poll cancels the poll without a stale error", async ({
    page,
    request,
    baseURL,
  }) => {
    const trackA = await getFixtureTrack(request, baseURL!);
    const trackB = await getSecondFixtureTrack(request, baseURL!);
    let aHits = 0;
    await page.route(`**/api/analysis/${trackA.id}`, async (route) => {
      aHits += 1;
      const body = JSON.stringify({
        id: trackA.id,
        status: "processing",
        progress: 10,
        message: "Analyzing beats",
      });
      // requests 1-2 (initial load + first poll) answer fast so the
      // "Analyzing" status renders promptly...
      if (aHits <= 2) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body,
        });
      }
      // ...then hold poll requests open so cancellation lands mid-fetch
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body,
        });
      } catch {
        // the poll was aborted while this response was pending — expected
      }
    });

    await page.goto(`/listen/${trackA.id}`);
    await expect(page.locator("#analysis-status")).toHaveText("Analyzing");
    // let the third request (a hanging poll) go out
    await page.waitForTimeout(POLL_INTERVAL_MS + 1_000);
    expect(aHits).toBeGreaterThan(2);

    // record every status text from here on; switching tracks must never
    // flash an error from the cancelled load
    await page.evaluate(() => {
      const target = document.getElementById("analysis-status")!;
      const log: string[] = [];
      (window as unknown as { __statusLog: string[] }).__statusLog = log;
      new MutationObserver(() => {
        log.push(target.textContent ?? "");
      }).observe(target, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });

    await page.locator('[data-tab-button="top"]').click();
    await page.locator(`a[data-track-id="${trackB.id}"]`).click();
    await waitForTrackLoaded(page);
    await expect(page).toHaveURL(new RegExp(trackB.id));

    // the cancelled poll must not keep hitting track A's endpoint
    const aHitsAfterSwitch = aHits;
    await page.waitForTimeout(POLL_INTERVAL_MS * 2 + 1_000);
    expect(aHits).toBe(aHitsAfterSwitch);

    const statusLog = await page.evaluate(
      () => (window as unknown as { __statusLog: string[] }).__statusLog,
    );
    const errorEntries = statusLog.filter((text) =>
      /load failed|something went wrong|aborted/i.test(text),
    );
    expect(errorEntries).toEqual([]);
    await expect(page.locator("#play-status")).toHaveClass(/\bhidden\b/);
  });
});

test.describe("sleep timer expiry", () => {
  test("expiry stops playback and resets the timer to Off", async ({
    page,
  }) => {
    await page.clock.install();
    await loadFirstTopTrack(page);
    await page.locator("#viz-play").click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );

    await page.locator("#settings-open").click();
    await page.locator("#sleep-timer-select").selectOption("900000");
    await page.locator("#sleep-timer-set").click(); // applies and closes settings

    await page.clock.fastForward("16:00");

    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Play",
    );
    await page.locator("#settings-open").click();
    await expect(page.locator("#sleep-timer-current")).toHaveText("Off");
  });
});

test.describe("swing render token", () => {
  test("switching away mid-swing-render cancels cleanly", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.keyboard.press("e");
    await page.locator("#audio-mode-swing").check();
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#analysis-status")).toHaveText(
      "Adding swing to the track...",
    );
    await expect(page).toHaveURL(/am=swing/);

    // switch back off while the swing buffer is still rendering
    await page.keyboard.press("e");
    await page.locator("#audio-mode-off").check();
    await page.locator("#tuning-apply").click();
    await expect(page).not.toHaveURL(/am=swing/);

    // the stale render must not leave the status stuck or block playback
    await expect(page.locator("#play-status")).toHaveClass(/\bhidden\b/);
    await page.locator("#viz-play").click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
  });

  test("swing render completes and the track plays", async ({ page }) => {
    test.setTimeout(240_000);
    await loadFirstTopTrack(page);
    await page.keyboard.press("e");
    await page.locator("#audio-mode-swing").check();
    await page.locator("#tuning-apply").click();
    await expect(page.locator("#analysis-status")).toHaveText(
      "Adding swing to the track...",
    );
    // (Play being blocked while the buffer renders is pinned by unit tests —
    // playback.test.ts swing-block cases; the render can finish faster than
    // an e2e click, so asserting it here would be racy.)

    // render completes (WASM pitch-preserved re-render of the whole track)
    await expect(page.locator("#play-status")).toHaveClass(/\bhidden\b/, {
      timeout: 180_000,
    });
    await expect(page).toHaveURL(/am=swing/);
    await page.locator("#viz-play").click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
  });
});
