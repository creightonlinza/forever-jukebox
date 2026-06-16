import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN_KEY_STORAGE_KEY } from "../../admin";
import { useAppStore } from "../../store";
import { PlayMenu } from "./PlayMenu";

const h = vi.hoisted(() => ({
  getPendingDelete: vi.fn(),
  performDelete: vi.fn(),
  toggleFavorite: vi.fn(),
  copyShortUrl: vi.fn(),
}));

vi.mock("../../wire/delete-job", () => ({
  getPendingDelete: h.getPendingDelete,
  performDelete: h.performDelete,
}));
vi.mock("../../wire/favorites", () => ({ toggleFavorite: h.toggleFavorite }));
vi.mock("../../wire/playback", () => ({ copyShortUrl: h.copyShortUrl }));
vi.mock("../../playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback")>()),
  openTuning: vi.fn(),
  openInfo: vi.fn(),
}));
vi.mock("../../runtime", () => ({ getAppContext: vi.fn(() => ({})) }));

describe("PlayMenu", () => {
  beforeEach(() => {
    localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
    h.getPendingDelete.mockReturnValue({
      jobId: "job1",
      trackId: "track1",
      adminKey: null,
    });
    h.performDelete.mockReset();
    h.performDelete.mockResolvedValue(undefined);
    h.toggleFavorite.mockReset();
    h.copyShortUrl.mockReset();
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
    render(<PlayMenu />);
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
    render(<PlayMenu />);
    expect(document.getElementById("play-title")?.textContent).toBe(
      "Song (nightcore) — Artist",
    );
  });

  it("shows the bring-it-home note only in jukebox mode with the mode on", () => {
    render(<PlayMenu />);
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
    render(<PlayMenu />);
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
    render(<PlayMenu />);
    const star = document.getElementById("favorite-toggle");
    expect(star?.classList.contains("active")).toBe(true);
    expect(star?.getAttribute("aria-label")).toBe("Remove from Favorites");
  });

  it("shows the delete button only when eligible or admin", () => {
    render(<PlayMenu />);
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
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    render(<PlayMenu />);
    await userEvent.click(document.getElementById("delete-job")!);
    expect(useAppStore.getState().deleteConfirmOpen).toBe(true);
    await userEvent.click(document.getElementById("delete-confirm-delete")!);
    await waitFor(() => {
      expect(h.performDelete).toHaveBeenCalledWith({
        jobId: "job1",
        trackId: "track1",
        adminKey: null,
      });
      expect(useAppStore.getState().deleteConfirmOpen).toBe(false);
    });
  });

  it("bails out of delete when the job changes under the open modal", async () => {
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    render(<PlayMenu />);
    await userEvent.click(document.getElementById("delete-job")!);
    expect(useAppStore.getState().deleteConfirmOpen).toBe(true);

    // The track auto-advanced while the modal was open; the live pending job
    // no longer matches the snapshot frozen at modal-open.
    h.getPendingDelete.mockReturnValue({ jobId: "job2", trackId: "track2", adminKey: null });

    await userEvent.click(document.getElementById("delete-confirm-delete")!);
    await waitFor(() => {
      expect(useAppStore.getState().deleteConfirmOpen).toBe(false);
    });
    expect(h.performDelete).not.toHaveBeenCalled();
  });

  it("guards against double-clicking delete while a delete is in flight", async () => {
    let resolveDelete!: () => void;
    h.performDelete.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    render(<PlayMenu />);
    await userEvent.click(document.getElementById("delete-job")!);
    const deleteButton = document.getElementById("delete-confirm-delete")!;

    await userEvent.click(deleteButton);
    // Second click while the first delete is still pending must be ignored.
    await userEvent.click(deleteButton);
    expect(h.performDelete).toHaveBeenCalledTimes(1);
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveDelete();
    });
    expect(useAppStore.getState().deleteConfirmOpen).toBe(false);
  });

  it("cancels the confirm modal with Escape", async () => {
    act(() => {
      useAppStore.setState({ deleteEligible: true });
    });
    render(<PlayMenu />);
    await userEvent.click(document.getElementById("delete-job")!);
    await userEvent.keyboard("{Escape}");
    expect(useAppStore.getState().deleteConfirmOpen).toBe(false);
    expect(h.performDelete).not.toHaveBeenCalled();
  });

  it("delegates copy link and favorite toggle", async () => {
    render(<PlayMenu />);
    await userEvent.click(document.getElementById("short-url")!);
    expect(h.copyShortUrl).toHaveBeenCalled();
    await userEvent.click(document.getElementById("favorite-toggle")!);
    expect(h.toggleFavorite).toHaveBeenCalled();
  });
});
