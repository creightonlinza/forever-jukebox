import { beforeEach, describe, expect, it, vi  } from "vitest";
import type { AppContext, AppState } from "./context";
import {
  loadTrackById,
  loadTrackByJobId,
  togglePlayback,
  type PlaybackDeps,
} from "./playback";
import { setPlayMode } from "./playback-ui";
import { emptyPlaylist, type PlaylistTrack } from "./playlist";
import { setAppRuntime, setPlaybackDeps } from "./runtime";
import { useAppStore } from "./store";
import { showToast } from "./ui";
import {
  addToPlaylist,
  advanceAutocanonizerOnEnded,
  clearPlaylist,
  handleNormalTrackSelected,
  loadPlaylistIndex,
  playlistNext,
  resetPlaylistActionsForTest,
} from "./playlist-actions";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./ui", async (importActual) => ({
  ...(await importActual<typeof import("./ui")>()),
  showToast: vi.fn(),
}));
vi.mock("./playback", async (importActual) => ({
  ...(await importActual<typeof import("./playback")>()),
  loadTrackById: vi.fn(async () => true),
  loadTrackByJobId: vi.fn(async () => true),
  togglePlayback: vi.fn(),
}));
vi.mock("./playback-ui", () => ({
  setPlayMode: vi.fn(),
}));


function setLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
}

function track(id: string, sourceType: PlaylistTrack["sourceType"] = "youtube") {
  return {
    id,
    sourceType,
    title: `Track ${id}`,
    artist: "Artist",
    duration: null,
  } satisfies PlaylistTrack;
}


const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
});

function createDeps(overrides?: Partial<AppState>) {
  if (overrides) {
    useAppStore.setState(overrides);
  }
  const context = {} as unknown as AppContext;
  const playbackDeps: PlaybackDeps = {
    setActiveTab: vi.fn(),
    navigateToTab: vi.fn(),
    updateTrackUrl: vi.fn(),
    setAnalysisStatus: vi.fn(),
    setLoadingProgress: vi.fn(),
  };
  setAppRuntime(context);
  setPlaybackDeps(playbackDeps);
  return { context, playbackDeps };
}

describe("playlist handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlaylistActionsForTest();
    vi.mocked(loadTrackById).mockResolvedValue(true);
    vi.mocked(loadTrackByJobId).mockResolvedValue(true);
    setLocalStorage();
    setWindowUrl("http://localhost/listen");
  });

  it("adds with current track and reports duplicate/full toasts", () => {
    createDeps({
      lastTrackId: "current",
      lastSourceProvider: "youtube",
      trackTitle: "Current",
    } as Partial<AppState>);
    addToPlaylist(track("next"));
    expect(useAppStore.getState().playlist.tracks.map((item) => item.id)).toEqual([
      "current",
      "next",
    ]);

    addToPlaylist(track("next"));
    expect(showToast).toHaveBeenCalledWith(
            "Already in playlist",
    );

    useAppStore.setState({
      playlist: {
      tracks: Array.from({ length: 10 }, (_, index) => track(`${index}`)),
      currentIndex: 0,
    }
    });
    addToPlaylist(track("extra"));
    expect(showToast).toHaveBeenCalledWith(
            "Playlist is full.",
    );
  });

  it("rejects an add with no current track without toasting success", () => {
    createDeps();
    addToPlaylist(track("next"));

    expect(showToast).toHaveBeenCalledWith(
            "Track cannot be added to playlist.",
    );
  });

  it("uses the job id as an upload when adding the current uploaded track", () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    createDeps({
      lastTrackId: null,
      lastJobId: jobId,
      lastSourceProvider: "upload",
      trackTitle: "Upload",
    } as Partial<AppState>);
    addToPlaylist(track("next"));

    expect(useAppStore.getState().playlist.tracks[0]).toMatchObject({
      id: jobId,
      sourceType: "upload",
    });
  });

  it("uses provider source ids when adding the current provider track", () => {
    createDeps({
      lastTrackId: "soundcloud:source-1",
      lastSourceProvider: "soundcloud",
      trackTitle: "Provider Track",
    } as Partial<AppState>);
    addToPlaylist(track("next"));

    expect(useAppStore.getState().playlist.tracks[0]).toMatchObject({
      id: "source-1",
      sourceType: "soundcloud",
    });
  });

  it("shows an invalid message for malformed playlist tracks", () => {
    createDeps({
      lastTrackId: "current",
      lastSourceProvider: "youtube",
      trackTitle: "Current",
    } as Partial<AppState>);
    addToPlaylist({ ...track(""), id: "" });

    expect(showToast).toHaveBeenCalledWith(
            "Track cannot be added to playlist.",
    );
  });

  it("clears inactive saved playlists on normal track selection", () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: -1 },
    } as Partial<AppState>);
    handleNormalTrackSelected(track("outside"));

    expect(useAppStore.getState().playlist).toEqual(emptyPlaylist());
  });

  it("replaces the active playlist item on normal track selection", () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 1 },
    } as Partial<AppState>);
    handleNormalTrackSelected(track("outside"));

    expect(useAppStore.getState().playlist.currentIndex).toBe(1);
    expect(useAppStore.getState().playlist.tracks.map((item) => item.id)).toEqual([
      "a",
      "outside",
    ]);
  });

  it("loads playlist items with playlist load options and blocks while busy", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    await loadPlaylistIndex(1);

    expect(loadTrackById).toHaveBeenCalledWith(
      deps.context,
      deps.playbackDeps,
      "b",
      {
        preserveUrlTuning: true,
        playlistLoad: true,
        selectedTrack: track("b"),
      },
    );

    useAppStore.setState({ audioLoadInFlight: true });
    await loadPlaylistIndex(0);
    expect(loadTrackById).toHaveBeenCalledTimes(1);
  });

  it("rolls back playlist activation when a playlist item load fails", async () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
      isRunning: false,
    } as Partial<AppState>);
    vi.mocked(loadTrackById).mockResolvedValueOnce(false);
    const loaded = await loadPlaylistIndex(1, { playAfterLoad: true });

    expect(loaded).toBe(false);
    expect(useAppStore.getState().playlist.currentIndex).toBe(0);
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("blocks rapid playlist skips while a playlist load is pending", () => {
    createDeps({
      playlist: {
        tracks: [track("a"), track("b"), track("c")],
        currentIndex: 0,
      },
    } as Partial<AppState>);
    vi.mocked(loadTrackById).mockImplementation(
      () =>
        new Promise<boolean>(() => {
          // Keep the first load pending.
        }),
    );
    playlistNext();
    playlistNext();

    expect(loadTrackById).toHaveBeenCalledTimes(1);
  });

  it("does not load or close the modal for the current playlist item", async () => {
    useAppStore.setState({ playlistModalOpen: true });
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    await loadPlaylistIndex(0, { closeModal: true });

    expect(loadTrackById).not.toHaveBeenCalled();
    expect(useAppStore.getState().playlistModalOpen).toBe(true);
  });

  it("closes the playlist modal immediately after selecting a playlist item", async () => {
    useAppStore.setState({ playlistModalOpen: true });
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    let resolveLoad: (value: boolean) => void = () => {};
    vi.mocked(loadTrackById).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const loadPromise = loadPlaylistIndex(1, { closeModal: true });

    expect(useAppStore.getState().playlistModalOpen).toBe(false);

    resolveLoad(true);
    await loadPromise;
  });

  it("applies the per-track play mode when loading a playlist track", async () => {
    const autocanonTrack = { ...track("b"), playMode: "autocanonizer" as const };
    createDeps({
      playlist: { tracks: [track("a"), autocanonTrack], currentIndex: 0 },
    } as Partial<AppState>);
    await loadPlaylistIndex(1);

    expect(setPlayMode).toHaveBeenCalledWith("autocanonizer");
  });

  it("defaults a playlist track without a stored mode to jukebox", async () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    await loadPlaylistIndex(1);

    expect(setPlayMode).toHaveBeenCalledWith("jukebox");
  });

  it("advances autocanonizer to the next playlist track when available", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const advanced = await advanceAutocanonizerOnEnded();

    expect(advanced).toBe(true);
    expect(loadTrackById).toHaveBeenCalledOnce();
    expect(togglePlayback).toHaveBeenCalledWith(deps.context);
  });

  it("does not report autocanonizer advance when the playlist load fails", async () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    vi.mocked(loadTrackById).mockResolvedValueOnce(false);
    const advanced = await advanceAutocanonizerOnEnded();

    expect(advanced).toBe(false);
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not advance autocanonizer without a next playlist track", async () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 1 },
    } as Partial<AppState>);
    await expect(advanceAutocanonizerOnEnded()).resolves.toBe(false);
    expect(loadTrackById).not.toHaveBeenCalled();
  });

  it("clears the playlist from the modal action", () => {
    createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    clearPlaylist();

    expect(useAppStore.getState().playlist).toEqual(emptyPlaylist());
    expect(useAppStore.getState().playlistModalOpen).toBe(false);
  });
});
