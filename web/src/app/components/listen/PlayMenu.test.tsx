import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN_KEY_STORAGE_KEY } from "../../admin";
import type { AppBridge } from "../../bridge";
import { useAppStore } from "../../store";
import { PlayMenu } from "./PlayMenu";

function createBridge() {
  return {
    context: {},
    listenPanel: {
      copyShortUrl: vi.fn(),
      toggleFavorite: vi.fn(),
      getPendingDelete: vi.fn(() => ({
        jobId: "job1",
        trackId: "track1",
        adminKey: null,
      })),
      performDelete: vi.fn(async () => {}),
      playlist: { selectIndex: vi.fn(), removeIndex: vi.fn(), clear: vi.fn() },
    },
  } as unknown as AppBridge;
}

describe("PlayMenu", () => {
  beforeEach(() => {
    localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
    act(() => {
      useAppStore.setState({
        audioLoaded: true,
        analysisLoaded: true,
        swingPreparing: false,
        playMode: "jukebox",
        jukeboxAudioMode: "off",
        trackTitle: "Song",
        trackArtist: "Artist",
        bringItHomeMode: false,
        deleteEligible: false,
        deleteConfirmOpen: false,
        favorites: [],
        favoriteToggleBusy: false,
        lastTrackId: "track1",
        lastJobId: "job1",
        lastSourceId: null,
        lastSourceProvider: null,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("hides the menu until a track is loaded", () => {
    act(() => {
      useAppStore.setState({ audioLoaded: false });
    });
    render(<PlayMenu bridge={createBridge()} />);
    expect(
      document.getElementById("play-menu")?.classList.contains("hidden"),
    ).toBe(true);
    act(() => {
      useAppStore.setState({ audioLoaded: true });
    });
    expect(
      document.getElementById("play-menu")?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("derives the marquee title with audio-mode suffix", () => {
    act(() => {
      useAppStore.setState({ jukeboxAudioMode: "nightcore" });
    });
    render(<PlayMenu bridge={createBridge()} />);
    expect(document.getElementById("play-title")?.textContent).toBe(
      "Song (nightcore) — Artist",
    );
  });

  it("shows the bring-it-home note only in jukebox mode with the mode on", () => {
    render(<PlayMenu bridge={createBridge()} />);
    const label = document.getElementById("bring-home-label");
    expect(label?.classList.contains("is-hidden")).toBe(true);
    act(() => {
      useAppStore.setState({ bringItHomeMode: true });
    });
    expect(label?.classList.contains("is-hidden")).toBe(false);
  });

  it("hides tune and info buttons in autocanonizer mode", () => {
    act(() => {
      useAppStore.setState({ playMode: "autocanonizer" });
    });
    render(<PlayMenu bridge={createBridge()} />);
    expect(
      document.getElementById("tuning")?.classList.contains("is-hidden"),
    ).toBe(true);
    expect(
      document.getElementById("track-info")?.classList.contains("is-hidden"),
    ).toBe(true);
  });

  it("marks the favorite star active for the current track", () => {
    act(() => {
      useAppStore.setState({
        favorites: [
          {
            uniqueSongId: "track1",
            title: "Song",
            artist: "Artist",
            duration: null,
            sourceType: "youtube",
          },
        ],
      });
    });
    render(<PlayMenu bridge={createBridge()} />);
    const star = document.getElementById("favorite-toggle");
    expect(star?.classList.contains("active")).toBe(true);
    expect(star?.getAttribute("aria-label")).toBe("Remove from Favorites");
  });

  it("shows the delete button only when eligible or admin", () => {
    render(<PlayMenu bridge={createBridge()} />);
    const button = () => document.getElementById("delete-job");
    expect(button()?.classList.contains("hidden")).toBe(true);
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    expect(button()?.classList.contains("hidden")).toBe(false);
    expect(button()?.getAttribute("title")).toBe(
      "Delete within 30 minutes of creation",
    );
  });

  it("opens the confirm modal and performs the delete", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    render(<PlayMenu bridge={bridge} />);
    await userEvent.click(document.getElementById("delete-job")!);
    expect(useAppStore.getState().deleteConfirmOpen).toBe(true);
    await userEvent.click(document.getElementById("delete-confirm-delete")!);
    await waitFor(() => {
      expect(bridge.listenPanel.performDelete).toHaveBeenCalledWith({
        jobId: "job1",
        trackId: "track1",
        adminKey: null,
      });
      expect(useAppStore.getState().deleteConfirmOpen).toBe(false);
    });
  });

  it("cancels the confirm modal with Escape", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    render(<PlayMenu bridge={bridge} />);
    await userEvent.click(document.getElementById("delete-job")!);
    await userEvent.keyboard("{Escape}");
    expect(useAppStore.getState().deleteConfirmOpen).toBe(false);
    expect(bridge.listenPanel.performDelete).not.toHaveBeenCalled();
  });

  it("delegates copy link and favorite toggle", async () => {
    const bridge = createBridge();
    render(<PlayMenu bridge={bridge} />);
    await userEvent.click(document.getElementById("short-url")!);
    expect(bridge.listenPanel.copyShortUrl).toHaveBeenCalled();
    await userEvent.click(document.getElementById("favorite-toggle")!);
    expect(bridge.listenPanel.toggleFavorite).toHaveBeenCalled();
  });
});
