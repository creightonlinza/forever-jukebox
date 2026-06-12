import { expect, test } from "@playwright/test";
import { expectToast, fetchAppConfig, waitForTrackLoaded } from "./helpers";

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

  // If the test dies between ingest and the UI delete, still try to remove
  // the track so reruns don't litter the shared environment.
  let createdJobId: string | null = null;
  test.afterEach(async ({ request, baseURL }) => {
    if (!createdJobId) {
      return;
    }
    await request
      .delete(`${baseURL}/api/jobs/${createdJobId}`)
      .catch(() => undefined);
    createdJobId = null;
  });

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

    // The freshly created job is inside its self-service delete window, so
    // deleting it through the real UI doubles as the live delete-flow test
    // and leaves the environment clean.
    const jobId = new URL(page.url()).pathname.split("/").pop()!;
    createdJobId = jobId;
    const deleteButton = page.locator("#delete-job");
    await expect(deleteButton).not.toHaveClass(/\bhidden\b/);
    await deleteButton.click();
    await expect(page.locator("#delete-confirm-modal")).toHaveClass(
      /\bopen\b/,
    );
    await page.locator("#delete-confirm-delete").click();
    await expectToast(page, "Deleted track");
    // back on the top tab, and the job really is gone server-side
    await expect(page.locator('[data-tab-panel="top"]')).toBeVisible();
    const gone = await request.get(`${baseURL}/api/analysis/${jobId}`);
    expect(gone.status()).toBe(404);
    createdJobId = null;
  });
});
