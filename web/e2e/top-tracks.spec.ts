import { expect, test } from "@playwright/test";

test.describe("Top Tracks panel", () => {
  test("top list loads with playlist-add buttons and listen links", async ({
    page,
  }) => {
    await page.goto("/");
    const items = page.locator("#top-songs .top-list-item");
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(25);
    const firstLink = items.first().locator("a");
    await expect(firstLink).toHaveAttribute("href", /^\/listen\//);
    await expect(
      items.first().locator(".playlist-add-button"),
    ).toBeAttached();
  });

  test("subtabs switch lists, title and refresh control", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#top-list-title")).toHaveText("Top 25");
    await expect(page.locator("#top-list-refresh")).toHaveAttribute(
      "aria-label",
      "Refresh Top 25",
    );

    await page.locator('[data-top-subtab="trending"]').click();
    await expect(page.locator("#top-list-title")).toHaveText("Trending");
    await expect(page.locator("#trending-songs")).toBeVisible();
    await expect(page.locator("#top-songs")).toHaveClass(/\bhidden\b/);

    await page.locator('[data-top-subtab="recent"]').click();
    await expect(page.locator("#top-list-title")).toHaveText("Last 25 Played");
    await expect(page.locator("#top-list-refresh")).toHaveAttribute(
      "aria-label",
      "Refresh Last 25 Played",
    );

    await page.locator('[data-top-subtab="favorites"]').click();
    // The favorites title carries a count badge ("<count> / <max>") alongside
    // the label, so match the label and the badge separately.
    await expect(page.locator("#top-list-title")).toContainText("Favorites");
    await expect(page.locator("#top-list-title .favorites-count")).toHaveText(
      "0 / 150",
    );
    await expect(page.locator("#top-list-refresh")).toHaveClass(/\bhidden\b/);
    await expect(page.locator("#favorites-filter")).toBeVisible();
    await expect(page.locator("#favorites-list")).toContainText(
      "No favorites yet.",
    );
  });

  test("trending/recent load lazily — fetched only on first visit", async ({
    page,
  }) => {
    let trendingFetches = 0;
    await page.route("**/api/trending*", async (route) => {
      trendingFetches += 1;
      await route.continue();
    });
    await page.goto("/");
    await expect(page.locator("#top-songs .top-list-item").first()).toBeVisible();
    expect(trendingFetches).toBe(0);

    await page.locator('[data-top-subtab="trending"]').click();
    await expect
      .poll(() => trendingFetches, { timeout: 10_000 })
      .toBe(1);

    // revisiting does not refetch
    await page.locator('[data-top-subtab="top"]').click();
    await page.locator('[data-top-subtab="trending"]').click();
    await page.waitForTimeout(500);
    expect(trendingFetches).toBe(1);
  });

  test("refresh button refetches the active list", async ({ page }) => {
    let topFetches = 0;
    await page.route("**/api/top*", async (route) => {
      topFetches += 1;
      await route.continue();
    });
    await page.goto("/");
    await expect(page.locator("#top-songs .top-list-item").first()).toBeVisible();
    expect(topFetches).toBe(1);
    await page.locator("#top-list-refresh").click();
    await expect.poll(() => topFetches).toBe(2);
  });

  test("clicking the main Top tab resets the subtab to All Time", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator('[data-top-subtab="favorites"]').click();
    await expect(page.locator("#top-list-title")).toContainText("Favorites");
    await page.locator('[data-tab-button="top"]').click();
    await expect(page.locator("#top-list-title")).toHaveText("Top 25");
  });

  test("list failure renders the error text", async ({ page }) => {
    await page.route("**/api/recent*", (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto("/");
    await page.locator('[data-top-subtab="recent"]').click();
    await expect(page.locator("#recent-songs")).toContainText(
      "Recent plays unavailable:",
    );
  });
});
