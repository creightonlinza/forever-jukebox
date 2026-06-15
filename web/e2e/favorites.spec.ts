import { expect, test } from "@playwright/test";
import {
  expectToast,
  getFixtureTrack,
  loadFirstTopTrack,
  loadTrackByDeepLink,
  waitForTrackLoaded,
} from "./helpers";

test.describe("favorites", () => {
  test("star toggles, persists fj-favorites, lists with filter and sort", async ({
    page,
  }) => {
    const trackId = await loadFirstTopTrack(page);
    const star = page.locator("#favorite-toggle");
    await expect(star).not.toHaveClass(/\bactive\b/);
    await expect(star).toHaveAttribute("aria-label", "Add to Favorites");

    await star.click();
    await expect(star).toHaveClass(/\bactive\b/);
    await expect(star).toHaveAttribute("aria-label", "Remove from Favorites");
    await expectToast(page, "Added to Favorites");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fj-favorites") ?? "[]"),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].uniqueSongId).toBe(trackId);

    // listed under Favorites with sortable headers
    await page.locator('[data-tab-button="top"]').click();
    await page.locator('[data-top-subtab="favorites"]').click();
    const rows = page.locator(".favorite-row");
    await expect(rows).toHaveCount(1);

    // filter
    await page.locator("#favorites-search-input").fill("zzz-no-match");
    await expect(page.locator("#favorites-list")).toContainText(
      'No favorites match "zzz-no-match".',
    );
    await page.locator("#favorites-search-input").fill("");
    await expect(rows).toHaveCount(1);

    // sort header toggles aria-sort
    const titleHeader = page.locator('[data-favorites-sort="title"]');
    await expect(
      page.locator('th[aria-sort="ascending"] [data-favorites-sort="title"]'),
    ).toBeAttached();
    await titleHeader.click();
    await expect(
      page.locator(
        'th[aria-sort="descending"] [data-favorites-sort="title"]',
      ),
    ).toBeAttached();

    // remove from the list (button is hover-revealed)
    await page.locator(".favorite-row").hover();
    await page.locator(".favorite-remove").click();
    await expectToast(page, "Removed from Favorites");
    await expect(page.locator("#favorites-list")).toContainText(
      "No favorites yet.",
    );
  });

  test("favoriting with active tuning stores it; clicking restores it", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id, "?jb=1&thresh=42");
    await page.locator("#favorite-toggle").click();
    await expectToast(page, "Added to Favorites");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fj-favorites") ?? "[]"),
    );
    expect(stored[0].tuningParams).toContain("jb=1");
    expect(stored[0].tuningParams).toContain("thresh=42");

    // navigate away, clear params, then click the favorite
    await page.locator('[data-tab-button="top"]').click();
    await page.locator('[data-top-subtab="favorites"]').click();
    const row = page.locator(".favorite-row a").first();
    await expect(row.locator(".favorite-tune-icon")).toBeAttached();
    await row.click();
    await waitForTrackLoaded(page);
    await expect(page).toHaveURL(/jb=1/);
    await expect(page).toHaveURL(/thresh=42/);
  });

  test("favoriting in autocanonizer mode stores it and restores the mode", async ({
    page,
  }) => {
    await loadFirstTopTrack(page);
    // switch to autocanonizer, then favorite
    await page.locator("#play-mode-select").selectOption("autocanonizer");
    await expect(page).toHaveURL(/[?&]mode=autocanonizer/);
    await page.locator("#favorite-toggle").click();
    await expectToast(page, "Added to Favorites");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fj-favorites") ?? "[]"),
    );
    expect(stored[0].playMode).toBe("autocanonizer");

    // navigate away (which strips the mode param), then restore via the list
    await page.locator('[data-tab-button="top"]').click();
    await page.locator('[data-top-subtab="favorites"]').click();
    // the row's link carries the mode so copy-link / open-in-new-tab work
    await expect(page.locator(".favorite-row a").first()).toHaveAttribute(
      "href",
      /[?&]mode=autocanonizer/,
    );
    await page.locator(".favorite-row a").first().click();
    await waitForTrackLoaded(page);

    // back in autocanonizer mode, URL and control reflect it
    await expect(page).toHaveURL(/[?&]mode=autocanonizer/);
    await expect(page.locator("#play-mode-select")).toHaveValue(
      "autocanonizer",
    );
    await expect(page.locator("#jukebox-viz")).toHaveClass(/is-canonizer/);
  });

  test("favorites survive a reload", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#favorite-toggle").click();
    await expectToast(page, "Added to Favorites");
    await page.reload();
    await page.locator('[data-tab-button="top"]').click();
    await page.locator('[data-top-subtab="favorites"]').click();
    await expect(page.locator(".favorite-row")).toHaveCount(1);
  });

  test("unfavoriting via the star updates the list", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#favorite-toggle").click();
    await expectToast(page, "Added to Favorites");
    await page.locator("#favorite-toggle").click();
    await expectToast(page, "Removed from Favorites");
    await expect(page.locator("#favorite-toggle")).not.toHaveClass(
      /\bactive\b/,
    );
  });
});

test.describe("favorites sync", () => {
  test("sync menu shows on the favorites subtab when the config allows it", async ({
    page,
    request,
    baseURL,
  }) => {
    const config = await (
      await request.get(`${baseURL}/api/app-config`)
    ).json();
    test.skip(!config.allow_favorites_sync, "favorites sync disabled");

    await page.goto("/");
    // hidden on other subtabs
    await expect(page.locator("#favorites-sync-button")).toHaveClass(
      /\bhidden\b/,
    );
    await page.locator('[data-top-subtab="favorites"]').click();
    const syncButton = page.locator("#favorites-sync-button");
    await expect(syncButton).not.toHaveClass(/\bhidden\b/);
    await expect(
      syncButton.locator(".favorites-sync-icon"),
    ).toHaveText("cloud_off");

    await syncButton.click();
    const menu = page.locator("#favorites-sync-menu");
    await expect(menu).not.toHaveClass(/\bhidden\b/);
    // without a code: refresh hidden, create labelled "Create sync code"
    await expect(
      menu.locator('[data-favorites-sync="refresh"]'),
    ).toHaveClass(/\bhidden\b/);
    await expect(
      menu.locator('[data-favorites-sync="create"]'),
    ).toHaveText("Create sync code");

    // click-away closes the menu
    await page.locator("#top-list-title").click();
    await expect(menu).toHaveClass(/\bhidden\b/);
  });

  test("enter-code modal validates input and supports Escape-free close", async ({
    page,
    request,
    baseURL,
  }) => {
    const config = await (
      await request.get(`${baseURL}/api/app-config`)
    ).json();
    test.skip(!config.allow_favorites_sync, "favorites sync disabled");

    await page.goto("/");
    await page.locator('[data-top-subtab="favorites"]').click();
    await page.locator("#favorites-sync-button").click();
    await page.locator('[data-favorites-sync="enter"]').click();
    const modal = page.locator("#favorites-sync-enter-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    await expect(page.locator("#favorites-sync-enter-input")).toBeFocused();

    // empty submit
    await page.locator("#favorites-sync-enter-button").click();
    await expect(page.locator("#favorites-sync-enter-status")).toHaveText(
      "Enter a sync code first.",
    );

    // bogus code → server rejects → error status
    await page.locator("#favorites-sync-enter-input").fill("not-a-real-code");
    await page.locator("#favorites-sync-enter-button").click();
    await expect(page.locator("#favorites-sync-enter-status")).toHaveText(
      "Unable to sync favorites.",
      { timeout: 15_000 },
    );

    await page.locator("#favorites-sync-enter-close").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);
  });

  test("create-sync-code round trip (mocked backend)", async ({ page }) => {
    // Mocked so the suite never creates junk sync rows on a shared backend.
    await page.route("**/api/favorites/sync", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ code: "alpha-bravo-charlie", favorites: [] }),
        });
      }
      return route.continue();
    });
    await page.route("**/api/app-config", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.allow_favorites_sync = true;
      return route.fulfill({ response, json: body });
    });

    await page.goto("/");
    await page.locator('[data-top-subtab="favorites"]').click();
    await page.locator("#favorites-sync-button").click();
    await page.locator('[data-favorites-sync="create"]').click();
    const modal = page.locator("#favorites-sync-create-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    await page.locator("#favorites-sync-create-button").click();
    await expect(page.locator("#favorites-sync-create-output")).toHaveText(
      "alpha-bravo-charlie",
    );
    await expect(page.locator("#favorites-sync-create-hint")).toHaveText(
      "Enter this code on another device to sync.",
    );
    expect(
      await page.evaluate(() => localStorage.getItem("fj-favorites-sync")),
    ).toBe("alpha-bravo-charlie");
    // sync icon flips to "has code"
    await page.locator("#favorites-sync-create-close").click();
    await expect(
      page.locator("#favorites-sync-button .favorites-sync-icon"),
    ).toHaveText("cloud");
  });
});
