import { expect, test } from "@playwright/test";
import {
  expectToast,
  getNthFixtureTrack,
  getSecondFixtureTrack,
  loadFirstTopTrack,
  waitForTrackLoaded,
} from "./helpers";

test.describe("playlists", () => {
  test("build a playlist, navigate it via the modal and prev/next", async ({
    page,
    request,
    baseURL,
  }) => {
    const second = await getSecondFixtureTrack(request, baseURL!);
    await loadFirstTopTrack(page);

    // playlist controls hidden before any playlist exists
    await expect(page.locator("#playlist-open")).toHaveClass(/is-hidden/);

    // add a second track from the top list (current track auto-seeds)
    await page.locator('[data-tab-button="top"]').click();
    const secondRow = page
      .locator(`a[data-track-id="${second.id}"]`)
      .locator("..");
    // add buttons are hover-revealed (and only rendered clickable once a
    // track is loaded, via body.playlist-add-enabled)
    await secondRow.hover();
    await secondRow.locator(".playlist-add-button").click();
    await expectToast(page, "Added to playlist");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fj-playlist") ?? "{}"),
    );
    expect(stored.tracks).toHaveLength(2);

    // adding the same track again is a duplicate
    await secondRow.hover();
    await secondRow.locator(".playlist-add-button").click();
    await expectToast(page, "Already in playlist");

    // listen tab: controls visible, modal lists both tracks
    await page.locator('[data-tab-button="play"]').click();
    const open = page.locator("#playlist-open");
    await expect(open).not.toHaveClass(/is-hidden/);
    await expect(open).toHaveAttribute("title", "Playlist (1/2)");
    await expect(page.locator("#playlist-previous")).toBeDisabled();
    await expect(page.locator("#playlist-next")).toBeEnabled();

    await open.click();
    const modal = page.locator("#playlist-modal");
    await expect(modal).toHaveClass(/\bopen\b/);
    const items = page.locator(".playlist-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toHaveClass(/is-current/);
    await expect(
      items.first().locator(".playlist-select"),
    ).toBeDisabled();

    // select track 2 → closes modal, loads it
    await items.nth(1).locator(".playlist-select").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(new RegExp(second.id));
    await waitForTrackLoaded(page);
    await expect(open).toHaveAttribute("title", "Playlist (2/2)");
    await expect(page.locator("#playlist-next")).toBeDisabled();

    // prev goes back to track 1
    await page.locator("#playlist-previous").click();
    await waitForTrackLoaded(page);
    await expect(open).toHaveAttribute("title", "Playlist (1/2)");
  });

  test("playlist preserves per-track play mode across prev/next", async ({
    page,
    request,
    baseURL,
  }) => {
    const second = await getSecondFixtureTrack(request, baseURL!);
    await loadFirstTopTrack(page);

    // Put the current (first) track into autocanonizer, then seed a playlist
    // with a second, plain (jukebox) track. The current track auto-seeds at
    // index 0, capturing its autocanonizer mode.
    await page.locator("#play-mode-select").selectOption("autocanonizer");
    await expect(page).toHaveURL(/[?&]mode=autocanonizer/);

    await page.locator('[data-tab-button="top"]').click();
    const secondRow = page.locator(`a[data-track-id="${second.id}"]`).locator("..");
    await secondRow.hover();
    await secondRow.locator(".playlist-add-button").click();
    await expectToast(page, "Added to playlist");

    await page.locator('[data-tab-button="play"]').click();

    // next → the plain track loads in jukebox (no stored mode → default)
    await page.locator("#playlist-next").click();
    await waitForTrackLoaded(page);
    await expect(page).toHaveURL(new RegExp(second.id));
    await expect(page.locator("#play-mode-select")).toHaveValue("jukebox");
    await expect(page).not.toHaveURL(/[?&]mode=autocanonizer/);

    // prev → the autocanonizer track loads back in autocanonizer
    await page.locator("#playlist-previous").click();
    await waitForTrackLoaded(page);
    await expect(page.locator("#play-mode-select")).toHaveValue("autocanonizer");
    await expect(page).toHaveURL(/[?&]mode=autocanonizer/);
  });

  test("playlist modal: Escape closes, remove disabled for current, clear empties", async ({
    page,
    request,
    baseURL,
  }) => {
    const second = await getSecondFixtureTrack(request, baseURL!);
    const third = await getNthFixtureTrack(request, baseURL!, 2);
    await loadFirstTopTrack(page);
    await page.locator('[data-tab-button="top"]').click();
    // three tracks: removal below 2 dissolves the playlist entirely, so a
    // 3-track list is the smallest that survives a removal
    for (const track of [second, third]) {
      const row = page
        .locator(`a[data-track-id="${track.id}"]`)
        .locator("..");
      await row.hover();
      await row.locator(".playlist-add-button").click();
      await expectToast(page, "Added to playlist");
    }
    await page.locator('[data-tab-button="play"]').click();
    await page.locator("#playlist-open").click();
    const modal = page.locator("#playlist-modal");
    await expect(modal).toHaveClass(/\bopen\b/);

    await page.keyboard.press("Escape");
    await expect(modal).not.toHaveClass(/\bopen\b/);

    await page.locator("#playlist-open").click();
    const items = page.locator(".playlist-item");
    await expect(items).toHaveCount(3);
    await expect(items.first().locator(".playlist-remove")).toBeDisabled();
    await items.nth(2).locator(".playlist-remove").click();
    await expect(items).toHaveCount(2);

    // clearing closes the modal and hides the controls
    await page.locator("#playlist-clear").click();
    await expect(modal).not.toHaveClass(/\bopen\b/);
    await expect(page.locator("#playlist-open")).toHaveClass(/is-hidden/);
    // an empty playlist removes the storage key outright
    expect(
      await page.evaluate(() => localStorage.getItem("fj-playlist")),
    ).toBeNull();
  });

  test("removing below two tracks dissolves the playlist", async ({
    page,
    request,
    baseURL,
  }) => {
    // Pinned: a playlist needs >=2 tracks to exist; removing the second-to-
    // last track empties it (removePlaylistTrack → emptyPlaylist()).
    const second = await getSecondFixtureTrack(request, baseURL!);
    await loadFirstTopTrack(page);
    await page.locator('[data-tab-button="top"]').click();
    const row = page
      .locator(`a[data-track-id="${second.id}"]`)
      .locator("..");
    await row.hover();
    await row.locator(".playlist-add-button").click();
    await expectToast(page, "Added to playlist");

    await page.locator('[data-tab-button="play"]').click();
    await page.locator("#playlist-open").click();
    const items = page.locator(".playlist-item");
    await expect(items).toHaveCount(2);
    await items.nth(1).locator(".playlist-remove").click();
    await expect(page.locator("#playlist-modal")).toContainText(
      "No playlist yet.",
    );
    await expect(page.locator("#playlist-clear")).toBeDisabled();
    expect(
      await page.evaluate(() => localStorage.getItem("fj-playlist")),
    ).toBeNull();
  });

  test("saved playlist resurfaces after reload via the status-row button", async ({
    page,
    request,
    baseURL,
  }) => {
    const second = await getSecondFixtureTrack(request, baseURL!);
    await loadFirstTopTrack(page);
    await page.locator('[data-tab-button="top"]').click();
    const secondRow = page
      .locator(`a[data-track-id="${second.id}"]`)
      .locator("..");
    // add buttons are hover-revealed (and only rendered clickable once a
    // track is loaded, via body.playlist-add-enabled)
    await secondRow.hover();
    await secondRow.locator(".playlist-add-button").click();
    await expectToast(page, "Added to playlist");

    // fresh load with no track: the saved playlist offer appears
    await page.goto("/listen");
    await expect(page).toHaveURL(/\/$/);
    await page.locator('[data-tab-button="play"]').click();
    const saved = page.locator("#saved-playlist");
    await expect(saved).not.toHaveClass(/\bhidden\b/);
    await saved.click();
    await expect(page.locator("#playlist-modal")).toHaveClass(/\bopen\b/);
    await expect(page.locator(".playlist-item")).toHaveCount(2);
  });

  test("playlist add buttons stay hidden until a track is loaded", async ({
    page,
  }) => {
    // Without a loaded track, body.playlist-add-enabled is absent and CSS
    // keeps every add button display:none — so the "Load a track before
    // starting a playlist." toast is unreachable through the UI. Pin the
    // hidden state instead.
    await page.goto("/");
    const row = page.locator("#top-songs .top-list-item").first();
    await expect(row).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.body.classList.contains("playlist-add-enabled"),
      ),
    ).toBe(false);
    await row.hover();
    await expect(
      row.locator(".playlist-add-button"),
    ).toBeHidden();
  });
});
