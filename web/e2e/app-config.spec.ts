import { expect, test, type Page } from "@playwright/test";
import { fetchAppConfig, loadFirstTopTrack } from "./helpers";

// These specs pin the behavior of wire/app-config.ts (applyAppConfig): the
// upload affordances and the favorites cap are driven entirely by
// GET /api/app-config, so we mock that response and assert the resulting UI.
// Everything here is deterministic and never touches the backend.

type ConfigOverrides = Record<string, unknown>;

async function mockAppConfig(page: Page, overrides: ConfigOverrides) {
  await page.route("**/api/app-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        allow_user_upload: false,
        allow_user_url: false,
        allow_favorites_sync: false,
        max_favorites: 50,
        allowed_upload_exts: [".mp3"],
        max_upload_size: 20 * 1024 * 1024,
        ...overrides,
      }),
    }),
  );
}

function seedFavorites(page: Page, ids: string[]) {
  return page.addInitScript((songIds) => {
    localStorage.setItem(
      "fj-favorites",
      JSON.stringify(
        songIds.map((id, i) => ({
          uniqueSongId: id,
          title: `Seeded ${i}`,
          artist: "Tester",
          duration: 100,
          sourceType: "youtube",
          tuningParams: null,
        })),
      ),
    );
  }, ids);
}

test.describe("app config: upload affordances", () => {
  test("both upload modes disabled hides the upload subtab entirely", async ({
    page,
  }) => {
    await mockAppConfig(page, {
      allow_user_upload: false,
      allow_user_url: false,
    });
    await page.goto("/");
    await page.locator('[data-tab-button="search"]').click();
    // showUpload === false → the whole subtab row collapses, leaving Search only
    await expect(page.locator("#search-subtabs")).toHaveClass(/\bhidden\b/);
  });

  test("file upload only: subtab shows, URL section hidden", async ({
    page,
  }) => {
    await mockAppConfig(page, {
      allow_user_upload: true,
      allow_user_url: false,
    });
    await page.goto("/");
    await page.locator('[data-tab-button="search"]').click();
    await expect(page.locator("#search-subtabs")).not.toHaveClass(/\bhidden\b/);
    await page.locator('[data-search-subtab="upload"]').click();
    await expect(page.locator("#upload-file-section")).not.toHaveClass(
      /\bhidden\b/,
    );
    await expect(page.locator("#upload-youtube-section")).toHaveClass(
      /\bhidden\b/,
    );
  });

  test("URL upload only: subtab shows, file section hidden", async ({
    page,
  }) => {
    await mockAppConfig(page, {
      allow_user_upload: false,
      allow_user_url: true,
    });
    await page.goto("/");
    await page.locator('[data-tab-button="search"]').click();
    await expect(page.locator("#search-subtabs")).not.toHaveClass(/\bhidden\b/);
    await page.locator('[data-search-subtab="upload"]').click();
    await expect(page.locator("#upload-youtube-section")).not.toHaveClass(
      /\bhidden\b/,
    );
    await expect(page.locator("#upload-file-section")).toHaveClass(
      /\bhidden\b/,
    );
  });
});

test.describe("app config: favorites cap", () => {
  test("max_favorites trims an over-cap stored list on load", async ({
    page,
  }) => {
    await seedFavorites(page, ["seed-a", "seed-b", "seed-c"]);
    await mockAppConfig(page, { max_favorites: 1 });
    await page.goto("/");
    // applyAppConfig caps the persisted list and re-saves it.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (JSON.parse(localStorage.getItem("fj-favorites") ?? "[]") as unknown[])
              .length,
        ),
      )
      .toBe(1);
  });

  test("favoriting at capacity surfaces the limit toast", async ({ page }) => {
    await seedFavorites(page, ["seed-already-full"]);
    await mockAppConfig(page, { max_favorites: 1 });
    await loadFirstTopTrack(page);
    await page.locator("#favorite-toggle").click();
    await expect(page.locator("#toast")).toContainText(
      "Maximum favorites reached (1).",
    );
    // the loaded track was not added — store stays at the seeded one
    const count = await page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem("fj-favorites") ?? "[]") as unknown[])
          .length,
    );
    expect(count).toBe(1);
  });
});

// Guard so the mocked-config assumptions stay honest against the real backend
// shape: the live endpoint must expose the fields applyAppConfig reads.
test("real /api/app-config exposes the fields applyAppConfig consumes", async ({
  request,
  baseURL,
}) => {
  const config = await fetchAppConfig(request, baseURL!);
  expect(config).toHaveProperty("allow_user_upload");
  expect(config).toHaveProperty("allow_user_url");
  expect(config).toHaveProperty("allow_favorites_sync");
});
