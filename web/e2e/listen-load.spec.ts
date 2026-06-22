import { expect, test } from "@playwright/test";
import {
  fetchTopTracks,
  getFixtureTrack,
  loadFirstTopTrack,
  loadTrackByDeepLink,
} from "./helpers";

test.describe("loading tracks into the Listen panel", () => {
  test("clicking a top-list track loads it (status → viz lifecycle)", async ({
    page,
  }) => {
    await page.goto("/");
    const link = page.locator("#top-songs .top-list-item a").first();
    const label = (await link.textContent()) ?? "";
    await link.click();
    await expect(page).toHaveURL(/\/listen\//);
    // status panel shows while loading, then hides
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
    await expect(page.locator("#play-status")).toHaveClass(/\bhidden\b/);
    await expect(page.locator("#play-menu")).not.toHaveClass(/\bhidden\b/);
    // both marquee titles show the track
    const expectedTitle = label.split(" — ")[0];
    await expect(page.locator("#play-title")).toContainText(expectedTitle);
    await expect(page.locator("#viz-now-playing")).toContainText(
      expectedTitle,
    );
    // canvases mounted by the controllers
    expect(
      await page.locator("#viz-layer canvas").count(),
    ).toBeGreaterThanOrEqual(1);
  });

  test("deep link with tuning params applies them to the engine", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id, "?jb=1&thresh=37");
    await expect(page).toHaveURL(/\?jb=1&thresh=37$/);

    await page.locator("#tuning").click();
    await expect(page.locator("#tuning-modal")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#threshold")).toHaveValue("37");
    await expect(page.locator("#just-backwards")).toBeChecked();
    await expect(page.locator("#min-jump-distance")).toHaveValue("0");
    await expect(page.locator("#min-jump-distance-val")).toHaveText(
      "Any distance",
    );
  });

  test("deep link by source id rewrites the URL to the job id", async ({
    page,
    request,
    baseURL,
  }) => {
    const items = await fetchTopTracks(request, baseURL!);
    const youtubeTrack = items.find(
      (t) => t.source_provider === "youtube" && t.source_id,
    );
    test.skip(!youtubeTrack, "no analyzed youtube-sourced track available");
    await page.goto(`/listen/${youtubeTrack!.source_id}`);
    // the existing job is found by source id and the URL migrates to job id
    await expect(page).toHaveURL(new RegExp(`/listen/${youtubeTrack!.id}`), {
      timeout: 45_000,
    });
    await expect(page.locator("#viz-panel")).not.toHaveClass(/\bhidden\b/, {
      timeout: 45_000,
    });
  });

  test("info modal shows real track stats", async ({ page }) => {
    await loadFirstTopTrack(page);
    await page.locator("#track-info").click();
    await expect(page.locator("#info-modal")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#info-duration")).not.toHaveText("00:00:00");
    const beats = Number(await page.locator("#info-beats").textContent());
    expect(beats).toBeGreaterThan(0);
    const branches = Number(
      await page.locator("#info-branches").textContent(),
    );
    expect(branches).toBeGreaterThan(0);
    await expect(page.locator("#info-deleted-branches")).toHaveText("0");
    // close via backdrop
    await page.locator("#info-modal").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("#info-modal")).not.toHaveClass(/\bopen\b/);
  });

  test("copy link puts the canonical short URL on the clipboard", async ({
    page,
    request,
    baseURL,
  }) => {
    const track = await getFixtureTrack(request, baseURL!);
    await loadTrackByDeepLink(page, track.id, "?jb=1&thresh=40");
    await page.locator("#short-url").click();
    await expect(page.locator("#toast")).toContainText(
      "Link copied to clipboard",
    );
    const clipboard = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboard).toContain(`/listen/${track.id}`);
    expect(clipboard).toContain("jb=1");
    expect(clipboard).toContain("thresh=40");
  });

  test("failed track load surfaces the error in the status panel", async ({
    page,
  }) => {
    await page.goto("/listen/00000000000000000000000000000000");
    await expect(page.locator("#analysis-status")).toContainText(
      "Something went wrong",
      { timeout: 20_000 },
    );
    await expect(page.locator("#viz-panel")).toHaveClass(/\bhidden\b/);
  });
});
