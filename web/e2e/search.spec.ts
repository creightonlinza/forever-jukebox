import { expect, test } from "@playwright/test";
import { expectToast, fetchAppConfig } from "./helpers";

test.describe("search panel", () => {
  test("empty query shows a prompt; input caps at 100 chars", async ({
    page,
  }) => {
    await page.goto("/search");
    await expect(page.locator("#search-hint")).toHaveText(
      "Step 1: Find a Spotify track.",
    );
    await expect(page.locator("#search-results")).toHaveText(
      "Search results will appear here.",
    );
    await page.locator("#search-button").click();
    await expect(page.locator("#search-results")).toHaveText(
      "Enter a search query.",
    );
    await page.locator("#search-input").fill("x".repeat(150));
    await expect(page.locator("#search-input")).toHaveValue("x".repeat(100));
  });

  test("Spotify search renders results; Enter submits too", async ({
    page,
  }) => {
    await page.goto("/search");
    await page.locator("#search-input").fill("daft punk around the world");
    await page.locator("#search-input").press("Enter");
    await expect(page.locator(".search-item").first()).toBeVisible({
      timeout: 20_000,
    });
    const first = page.locator(".search-item").first();
    await expect(first.locator("strong")).toContainText(/./);
  });

  test("Spotify result click reaches the YouTube match step (mocked lookup miss)", async ({
    page,
  }) => {
    // Force the existing-analysis lookup to miss so the flow always lands on
    // Step 2 regardless of backend contents.
    await page.route("**/api/jobs/by-track*", (route) =>
      route.fulfill({ status: 404, body: "{}" }),
    );
    await page.goto("/search");
    await page.locator("#search-input").fill("daft punk around the world");
    await page.locator("#search-button").click();
    await expect(page.locator(".search-item").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.locator(".search-item").first().click();
    await expect(page.locator("#search-hint")).toHaveText(
      "Step 2: Choose the closest YouTube match.",
      { timeout: 30_000 },
    );
    const matches = page.locator(".search-item");
    await expect(matches.first()).toBeVisible();
    // matches carry external open links that don't trigger selection
    const open = matches.first().locator(".search-open");
    await expect(open).toHaveAttribute("href", /youtube\.com\/watch/);
    await expect(open).toHaveAttribute("target", "_blank");
  });

  test("Spotify result click loads an existing analysis directly (mocked hit)", async ({
    page,
    request,
    baseURL,
  }) => {
    // Deterministic short-circuit: by-track returns a real analyzed job.
    const res = await request.get(`${baseURL}/api/top?limit=1`);
    const { items } = await res.json();
    test.skip(!items?.length, "no analyzed track to short-circuit to");
    const jobId = items[0].id;
    const jobRes = await request.get(`${baseURL}/api/analysis/${jobId}`);
    const job = await jobRes.json();
    await page.route("**/api/jobs/by-track*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(job),
      }),
    );
    await page.goto("/search");
    await page.locator("#search-input").fill("anything at all");
    await page.locator("#search-button").click();
    await expect(page.locator(".search-item").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.locator(".search-item").first().click();
    await expect(page).toHaveURL(new RegExp(`/listen/${jobId}`), {
      timeout: 45_000,
    });
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
  });

  test("search failure renders the error text", async ({ page }) => {
    await page.route("**/api/search/**", (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto("/search");
    await page.locator("#search-input").fill("whatever");
    await page.locator("#search-button").click();
    await expect(page.locator("#search-results")).toContainText(
      "Search failed:",
    );
  });
});

test.describe("upload panel", () => {
  test("subtab visibility and sections follow app config", async ({
    page,
    request,
    baseURL,
  }) => {
    const config = await fetchAppConfig(request, baseURL!);
    await page.goto("/search");
    const showUpload = Boolean(
      config.allow_user_upload || config.allow_user_url,
    );
    if (!showUpload) {
      await expect(page.locator("#search-subtabs")).toHaveClass(/\bhidden\b/);
      return;
    }
    await expect(page.locator("#search-subtabs")).not.toHaveClass(
      /\bhidden\b/,
    );
    await page.locator('[data-search-subtab="upload"]').click();
    await expect(page.locator("#search-panel-title")).toHaveText("Upload");
    await expect(page.locator("#upload-panel")).toBeVisible();
    if (config.allow_user_upload) {
      await expect(page.locator("#upload-file-section")).toBeVisible();
      await expect(page.locator("#upload-file-hint")).toContainText(
        "Max file size:",
      );
    }
    if (config.allow_user_url) {
      await expect(page.locator("#upload-youtube-section")).toBeVisible();
    }
    // clicking the Search main tab resets the subtab
    await page.locator('[data-tab-button="search"]').click();
    await expect(page.locator("#search-panel-title")).toHaveText("Search");
  });

  test("URL upload validates input client-side", async ({
    page,
    request,
    baseURL,
  }) => {
    const config = await fetchAppConfig(request, baseURL!);
    test.skip(!config.allow_user_url, "URL uploads disabled");
    await page.goto("/search");
    await page.locator('[data-search-subtab="upload"]').click();

    await page.locator("#upload-youtube-button").click();
    await expectToast(page, "Enter a supported URL.");

    await page
      .locator("#upload-youtube-input")
      .fill("https://example.com/not-supported");
    await page.locator("#upload-youtube-button").click();
    await expectToast(page, "Invalid or unsupported URL.");
  });

  test("file upload validates a missing file", async ({
    page,
    request,
    baseURL,
  }) => {
    const config = await fetchAppConfig(request, baseURL!);
    test.skip(!config.allow_user_upload, "file uploads disabled");
    await page.goto("/search");
    await page.locator('[data-search-subtab="upload"]').click();
    await page.locator("#upload-file-button").click();
    await expectToast(page, "Choose a file to upload.");
  });
});
