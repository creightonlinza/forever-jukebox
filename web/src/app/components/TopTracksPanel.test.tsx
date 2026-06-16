import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../store";
import { TopTracksPanel } from "./TopTracksPanel";

vi.mock("../api", () => ({
  fetchTopSongs: vi.fn(async () => [
    {
      id: "a3f3c0dc73c6476c9db95c227f9206f2",
      source_id: "abc123def45",
      source_provider: "youtube",
      title: "Song",
      artist: "Artist",
    },
  ]),
  fetchTrendingSongs: vi.fn(async () => []),
  fetchRecentSongs: vi.fn(async () => {
    throw new Error("boom");
  }),
}));

const h = vi.hoisted(() => ({
  selectTrack: vi.fn(),
  addToPlaylist: vi.fn(),
  selectFavorite: vi.fn(),
  removeFavoriteWithToast: vi.fn(),
  refreshFavoritesFromSync: vi.fn(async () => {}),
  enterSyncCode: vi.fn(async () => "replaced" as const),
  createSyncCode: vi.fn(async () => "alpha-bravo-charlie"),
}));

vi.mock("../track-select", () => ({ selectTrack: h.selectTrack }));
vi.mock("../playlist-actions", () => ({ addToPlaylist: h.addToPlaylist }));
vi.mock("../favorites-actions", () => ({
  selectFavorite: h.selectFavorite,
  removeFavoriteWithToast: h.removeFavoriteWithToast,
  refreshFavoritesFromSync: h.refreshFavoritesFromSync,
  enterSyncCode: h.enterSyncCode,
  createSyncCode: h.createSyncCode,
}));

describe("TopTracksPanel", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        activeTabId: "top",
        topSongsTab: "top",
        favorites: [],
        favoritesSyncCode: null,
        appConfig: null,
      });
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the top list lazily and renders job-id links", async () => {
    render(<TopTracksPanel />);
    const link = await screen.findByText("Song — Artist");
    expect(link.getAttribute("href")).toBe(
      "/listen/a3f3c0dc73c6476c9db95c227f9206f2",
    );
    await userEvent.click(link);
    expect(h.selectTrack).toHaveBeenCalledWith(
      "a3f3c0dc73c6476c9db95c227f9206f2",
      expect.objectContaining({
        id: "a3f3c0dc73c6476c9db95c227f9206f2",
        sourceType: "youtube",
        title: "Song",
      }),
    );
  });

  it("adds rows to the playlist", async () => {
    render(<TopTracksPanel />);
    await screen.findByText("Song — Artist");
    await userEvent.click(screen.getByLabelText("Add Song to playlist"));
    expect(h.addToPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a3f3c0dc73c6476c9db95c227f9206f2" }),
    );
    expect(h.selectTrack).not.toHaveBeenCalled();
  });

  it("updates the title and refresh control per subtab", async () => {
    render(<TopTracksPanel />);
    const title = document.getElementById("top-list-title");
    const refresh = document.getElementById("top-list-refresh");
    expect(title?.textContent).toBe("Top 25");
    expect(refresh?.getAttribute("aria-label")).toBe("Refresh Top 25");
    act(() => {
      useAppStore.setState({ topSongsTab: "recent" });
    });
    expect(title?.textContent).toBe("Last 25 Played");
    expect(refresh?.getAttribute("aria-label")).toBe("Refresh Last 25 Played");
    expect(refresh?.classList.contains("hidden")).toBe(false);
    act(() => {
      useAppStore.setState({ topSongsTab: "favorites" });
    });
    // The favorites title carries a count badge ("<count> / <max>") next to
    // the label, so assert the label and the badge separately.
    expect(title?.textContent).toContain("Favorites");
    expect(title?.querySelector(".favorites-count")?.textContent).toBe(
      "0 / 150",
    );
    expect(refresh?.classList.contains("hidden")).toBe(true);
  });

  it("shows an error message when a list fails to load", async () => {
    render(<TopTracksPanel />);
    act(() => {
      useAppStore.setState({ topSongsTab: "recent" });
    });
    await waitFor(() => {
      expect(
        document.getElementById("recent-songs")?.textContent,
      ).toContain("Recent plays unavailable:");
    });
  });

  it("refreshes the active list on demand", async () => {
    const api = await import("../api");
    render(<TopTracksPanel />);
    await screen.findByText("Song — Artist");
    expect(api.fetchTopSongs).toHaveBeenCalledTimes(1);
    await userEvent.click(document.getElementById("top-list-refresh")!);
    await waitFor(() => {
      expect(api.fetchTopSongs).toHaveBeenCalledTimes(2);
    });
  });

  it("renders, filters, sorts and removes favorites", async () => {
    act(() => {
      useAppStore.setState({
        topSongsTab: "favorites",
        favorites: [
          {
            uniqueSongId: "fav1",
            title: "Alpha",
            artist: "Zed",
            duration: null,
            sourceType: "youtube",
          },
          {
            uniqueSongId: "fav2",
            title: "Beta",
            artist: "Ann",
            duration: null,
            sourceType: "youtube",
            tuningParams: "jb=1",
          },
        ],
      });
    });
    render(<TopTracksPanel />);
    const rows = () =>
      Array.from(document.querySelectorAll(".favorite-row")).map(
        (row) => row.querySelector("a")?.textContent?.trim(),
      );
    expect(rows()).toEqual(["Alpha", "Beta tune"]);

    // sort by title desc
    await userEvent.click(screen.getByText("Title"));
    expect(rows()).toEqual(["Beta tune", "Alpha"]);

    // filter
    await userEvent.type(
      screen.getByLabelText("Search favorites"),
      "alpha",
    );
    expect(rows()).toEqual(["Alpha"]);
    await userEvent.clear(screen.getByLabelText("Search favorites"));

    // select a row
    await userEvent.click(screen.getByText("Alpha"));
    expect(h.selectFavorite).toHaveBeenCalledWith(
      "fav1",
      "youtube",
    );

    // remove
    await userEvent.click(
      screen.getByLabelText("Remove Alpha from Favorites"),
    );
    expect(h.removeFavoriteWithToast).toHaveBeenCalledWith("fav1");
  });

  it("shows sync controls only on favorites with sync allowed", async () => {
    act(() => {
      useAppStore.setState({
        topSongsTab: "favorites",
        appConfig: { allow_favorites_sync: true } as never,
        favoritesSyncCode: null,
      });
    });
    render(<TopTracksPanel />);
    const syncButton = document.getElementById("favorites-sync-button")!;
    expect(syncButton.classList.contains("hidden")).toBe(false);
    expect(syncButton.querySelector(".favorites-sync-icon")?.textContent).toBe(
      "cloud_off",
    );

    await userEvent.click(syncButton);
    const menu = document.getElementById("favorites-sync-menu")!;
    expect(menu.classList.contains("hidden")).toBe(false);
    // no code yet: refresh hidden, create labelled "Create sync code"
    expect(
      menu
        .querySelector('[data-favorites-sync="refresh"]')
        ?.classList.contains("hidden"),
    ).toBe(true);
    expect(
      menu.querySelector('[data-favorites-sync="create"]')?.textContent,
    ).toBe("Create sync code");

    // open the create modal and create a code
    await userEvent.click(menu.querySelector('[data-favorites-sync="create"]')!);
    const createModal = document.getElementById("favorites-sync-create-modal")!;
    expect(createModal.classList.contains("open")).toBe(true);
    await userEvent.click(
      document.getElementById("favorites-sync-create-button")!,
    );
    await waitFor(() => {
      expect(
        document.getElementById("favorites-sync-create-output")?.textContent,
      ).toBe("alpha-bravo-charlie");
    });
  });

  it("submits a sync code through the enter modal", async () => {
    act(() => {
      useAppStore.setState({
        topSongsTab: "favorites",
        appConfig: { allow_favorites_sync: true } as never,
        favoritesSyncCode: "old-code-here",
      });
    });
    render(<TopTracksPanel />);
    await userEvent.click(document.getElementById("favorites-sync-button")!);
    await userEvent.click(
      document.querySelector('[data-favorites-sync="enter"]')!,
    );
    const enterModal = document.getElementById("favorites-sync-enter-modal")!;
    expect(enterModal.classList.contains("open")).toBe(true);
    await userEvent.type(
      document.getElementById("favorites-sync-enter-input")!,
      "alpha-bravo-charlie",
    );
    await userEvent.click(
      document.getElementById("favorites-sync-enter-button")!,
    );
    await waitFor(() => {
      expect(h.enterSyncCode).toHaveBeenCalledWith(
        "alpha-bravo-charlie",
      );
      expect(enterModal.classList.contains("open")).toBe(false);
    });
  });
});
