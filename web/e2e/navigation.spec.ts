import { expect, test } from "@playwright/test";
import { getFixtureTrack, loadTrackByDeepLink } from "./helpers";

test.describe("tab navigation + URL contract", () => {
  test("home shows Top Tracks; all four panels persist in the DOM", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-tab-panel="top"]')).toBeVisible();
    for (const panel of ["top", "search", "play", "faq"]) {
      await expect(page.locator(`[data-tab-panel="${panel}"]`)).toBeAttached();
    }
    // only top visible
    for (const panel of ["search", "play", "faq"]) {
      await expect(page.locator(`[data-tab-panel="${panel}"]`)).toHaveClass(
        /\bhidden\b/,
      );
    }
    await expect(page.locator('[data-tab-button="top"]')).toHaveClass(
      /\bactive\b/,
    );
  });

  test("tab clicks update URL and panel visibility", async ({ page }) => {
    await page.goto("/");
    const cases: Array<[string, string]> = [
      ["search", "/search"],
      ["play", "/listen"],
      ["faq", "/faq"],
      ["top", "/"],
    ];
    for (const [tab, path] of cases) {
      await page.locator(`[data-tab-button="${tab}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
      await expect(page.locator(`[data-tab-panel="${tab}"]`)).not.toHaveClass(
        /\bhidden\b/,
      );
      await expect(page.locator(`[data-tab-button="${tab}"]`)).toHaveClass(
        /\bactive\b/,
      );
    }
  });

  test("hero title navigates home", async ({ page }) => {
    await page.goto("/faq");
    await page.locator("#hero-title-home").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-tab-panel="top"]')).toBeVisible();
  });

  test("offline app link is an external link, not a route", async ({
    page,
  }) => {
    await page.goto("/");
    const link = page.locator("a.tab-link");
    await expect(link).toHaveAttribute("href", "/offline/");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("unknown paths redirect to the top tab", async ({ page }) => {
    await page.goto("/definitely-not-a-route");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-tab-panel="top"]')).toBeVisible();
  });

  test("/listen without a track redirects to the top tab", async ({
    page,
  }) => {
    await page.goto("/listen");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-tab-panel="top"]')).toBeVisible();
  });

  test("FAQ subtabs route to /faq and /whats-new and survive history", async ({
    page,
  }) => {
    await page.goto("/faq");
    await expect(page.locator("#faq-panel-title")).toHaveText("FAQ");
    await page.locator('[data-faq-subtab="whats-new"]').click();
    await expect(page).toHaveURL(/\/whats-new$/);
    await expect(page.locator("#faq-panel-title")).toHaveText("What's New");
    await expect(page.locator("#faq-whats-new-panel")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/faq$/);
    await expect(page.locator("#faq-panel-title")).toHaveText("FAQ");

    await page.goForward();
    await expect(page).toHaveURL(/\/whats-new$/);
    await expect(page.locator("#faq-panel-title")).toHaveText("What's New");
  });

  test("hard load of /whats-new selects the FAQ tab and subtab", async ({
    page,
  }) => {
    await page.goto("/whats-new");
    await expect(page.locator('[data-tab-button="faq"]')).toHaveClass(
      /\bactive\b/,
    );
    await expect(page.locator("#faq-panel-title")).toHaveText("What's New");
  });

  test("query params strip when leaving the play tab and survive within it", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id, "?jb=1&thresh=40");
    await expect(page).toHaveURL(/\?jb=1&thresh=40$/);

    await page.locator('[data-tab-button="top"]').click();
    await expect(page).toHaveURL(/\/$/); // search stripped

    await page.locator('[data-tab-button="play"]').click();
    await expect(page).toHaveURL(/\/listen\/.+\?jb=1&thresh=40$/); // restored
  });

  test("back/forward across tabs keeps the loaded track alive", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id);
    const layerHandle = await page.evaluateHandle(() =>
      document.getElementById("viz-layer"),
    );

    await page.locator('[data-tab-button="faq"]').click();
    await expect(page).toHaveURL(/\/faq$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/listen\//);
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/);

    // the canvas-holding node must be the SAME node (panels persist)
    const sameNode = await page.evaluate(
      (el) => el === document.getElementById("viz-layer"),
      layerHandle,
    );
    expect(sameNode, "viz-layer node identity must survive history nav").toBe(
      true,
    );
  });

  test("viz-layer node identity survives tab switching (panels-persist invariant)", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id);
    const layerHandle = await page.evaluateHandle(() =>
      document.getElementById("viz-layer"),
    );
    for (const tab of ["top", "search", "faq", "play"]) {
      await page.locator(`[data-tab-button="${tab}"]`).click();
    }
    const sameNode = await page.evaluate(
      (el) => el === document.getElementById("viz-layer"),
      layerHandle,
    );
    expect(sameNode).toBe(true);
    await expect(page.locator("#viz-layer canvas").first()).toBeAttached();
  });
});
