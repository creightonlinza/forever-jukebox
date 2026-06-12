import { expect, test } from "@playwright/test";
import { fetchAppConfig, waitForTrackLoaded } from "./helpers";

// Full YouTube ingest → analysis → playback flow. This downloads real audio
// and runs the analysis engine, so it is opt-in and intended ONLY for a
// deployed test environment, never local CI:
//
//   E2E_BASE_URL=<deployed test env> E2E_ALLOW_ANALYSIS=1 \
//     npx playwright test e2e/youtube-analysis.spec.ts
//
// Uses a short Creative-Commons video so the job completes quickly and fits
// typical max_track_length limits (~2:30, official Blender channel).
const SHORT_CC_VIDEO_URL = "https://www.youtube.com/watch?v=SkVqJ1SGeL0"; // Caminandes 3: Llamigos

test.describe("full YouTube analysis flow", () => {
  test.skip(
    !process.env.E2E_ALLOW_ANALYSIS || !process.env.E2E_BASE_URL,
    "set E2E_BASE_URL and E2E_ALLOW_ANALYSIS=1 to run the full ingest flow",
  );
  test.setTimeout(8 * 60_000);

  test("upload-by-URL ingests, analyzes and plays a track", async ({
    page,
    request,
    baseURL,
  }) => {
    const config = await fetchAppConfig(request, baseURL!);
    test.skip(!config.allow_user_url, "URL uploads disabled in this env");

    await page.goto("/search");
    await page.locator('[data-search-subtab="upload"]').click();
    await page.locator("#upload-youtube-input").fill(SHORT_CC_VIDEO_URL);
    await page.locator("#upload-youtube-button").click();

    // lands on the Listen tab with the status panel narrating progress
    await expect(page).toHaveURL(/\/listen\//, { timeout: 60_000 });
    await expect(page.locator("#play-status")).not.toHaveClass(/\bhidden\b/);

    // analysis completes (download + beats can take minutes)
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 7 * 60_000,
    });
    await waitForTrackLoaded(page);

    // and it actually plays
    await page.locator("#viz-play").click();
    await expect(page.locator("#viz-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
    await expect
      .poll(
        async () => Number(await page.locator("#beats-played").textContent()),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
  });
});
