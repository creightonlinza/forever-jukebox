import { beforeEach, describe, expect, it, vi  } from "vitest";
import type { AppContext, AppState } from "../context";
import { togglePlayback } from "../playback";
import { emptyPlaylist, type PlaylistTrack } from "../playlist";
import { useAppStore } from "../store";
import { showToast } from "../ui";
import { createPlaylistHandlers } from "./playlist";
import { setWindowUrl } from "../__tests__/test-utils";

vi.mock("../ui", async (importActual) => ({
  ...(await importActual<typeof import("../ui")>()),
  showToast: vi.fn(),
}));
vi.mock("../playback", async (importActual) => ({
  ...(await importActual<typeof import("../playback")>()),
  togglePlayback: vi.fn(),
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
  return {
    context,
    loadTrackById: vi.fn(async () => true),
    loadTrackByJobId: vi.fn(async () => true),
    navigateToTabWithState: vi.fn(),
    setPlayMode: vi.fn(),
  };
}

describe("playlist handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocalStorage();
    setWindowUrl("http://localhost/listen");
  });

  it("adds with current track and reports duplicate/full toasts", () => {
    const deps = createDeps({
      lastTrackId: "current",
      lastSourceProvider: "youtube",
      trackTitle: "Current",
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleAddToPlaylist(track("next"));
    expect(useAppStore.getState().playlist.tracks.map((item) => item.id)).toEqual([
      "current",
      "next",
    ]);

    handlers.handleAddToPlaylist(track("next"));
    expect(showToast).toHaveBeenCalledWith(
            "Already in playlist",
    );

    useAppStore.setState({
      playlist: {
      tracks: Array.from({ length: 10 }, (_, index) => track(`${index}`)),
      currentIndex: 0,
    }
    });
    handlers.handleAddToPlaylist(track("extra"));
    expect(showToast).toHaveBeenCalledWith(
            "Playlist is full.",
    );
  });

  it("rejects an add with no current track without toasting success", () => {
    const deps = createDeps();
    const handlers = createPlaylistHandlers(deps);

    handlers.handleAddToPlaylist(track("next"));

    expect(showToast).toHaveBeenCalledWith(
            "Track cannot be added to playlist.",
    );
  });

  it("uses the job id as an upload when adding the current uploaded track", () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    const deps = createDeps({
      lastTrackId: null,
      lastJobId: jobId,
      lastSourceProvider: "upload",
      trackTitle: "Upload",
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleAddToPlaylist(track("next"));

    expect(useAppStore.getState().playlist.tracks[0]).toMatchObject({
      id: jobId,
      sourceType: "upload",
    });
  });

  it("uses provider source ids when adding the current provider track", () => {
    const deps = createDeps({
      lastTrackId: "soundcloud:source-1",
      lastSourceProvider: "soundcloud",
      trackTitle: "Provider Track",
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleAddToPlaylist(track("next"));

    expect(useAppStore.getState().playlist.tracks[0]).toMatchObject({
      id: "source-1",
      sourceType: "soundcloud",
    });
  });

  it("shows an invalid message for malformed playlist tracks", () => {
    const deps = createDeps({
      lastTrackId: "current",
      lastSourceProvider: "youtube",
      trackTitle: "Current",
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleAddToPlaylist({ ...track(""), id: "" });

    expect(showToast).toHaveBeenCalledWith(
            "Track cannot be added to playlist.",
    );
  });

  it("clears inactive saved playlists on normal track selection", () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: -1 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleNormalTrackSelected(track("outside"));

    expect(useAppStore.getState().playlist).toEqual(emptyPlaylist());
  });

  it("replaces the active playlist item on normal track selection", () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 1 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleNormalTrackSelected(track("outside"));

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
    const handlers = createPlaylistHandlers(deps);

    await handlers.loadPlaylistIndex(1);

    expect(deps.loadTrackById).toHaveBeenCalledWith("b", {
      preserveUrlTuning: true,
      playlistLoad: true,
      selectedTrack: track("b"),
    });

    useAppStore.setState({ audioLoadInFlight: true });
    await handlers.loadPlaylistIndex(0);
    expect(deps.loadTrackById).toHaveBeenCalledTimes(1);
  });

  it("rolls back playlist activation when a playlist item load fails", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
      isRunning: false,
    } as Partial<AppState>);
    deps.loadTrackById = vi.fn(async (): Promise<boolean> => false);
    const handlers = createPlaylistHandlers(deps);

    const loaded = await handlers.loadPlaylistIndex(1, { playAfterLoad: true });

    expect(loaded).toBe(false);
    expect(useAppStore.getState().playlist.currentIndex).toBe(0);
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("blocks rapid playlist skips while a playlist load is pending", () => {
    const deps = createDeps({
      playlist: {
        tracks: [track("a"), track("b"), track("c")],
        currentIndex: 0,
      },
    } as Partial<AppState>);
    deps.loadTrackById = vi.fn(
      () =>
        new Promise<boolean>(() => {
          // Keep the first load pending.
        }),
    );
    const handlers = createPlaylistHandlers(deps);

    handlers.handlePlaylistNext();
    handlers.handlePlaylistNext();

    expect(deps.loadTrackById).toHaveBeenCalledTimes(1);
  });

  it("does not load or close the modal for the current playlist item", async () => {
    useAppStore.setState({ playlistModalOpen: true });
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    await handlers.loadPlaylistIndex(0, { closeModal: true });

    expect(deps.loadTrackById).not.toHaveBeenCalled();
    expect(useAppStore.getState().playlistModalOpen).toBe(true);
  });

  it("closes the playlist modal immediately after selecting a playlist item", async () => {
    useAppStore.setState({ playlistModalOpen: true });
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    let resolveLoad: (value: boolean) => void = () => {};
    deps.loadTrackById = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const handlers = createPlaylistHandlers(deps);

    const loadPromise = handlers.loadPlaylistIndex(1, { closeModal: true });

    expect(useAppStore.getState().playlistModalOpen).toBe(false);

    resolveLoad(true);
    await loadPromise;
  });

  it("applies the per-track play mode when loading a playlist track", async () => {
    const autocanonTrack = { ...track("b"), playMode: "autocanonizer" as const };
    const deps = createDeps({
      playlist: { tracks: [track("a"), autocanonTrack], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    await handlers.loadPlaylistIndex(1);

    expect(deps.setPlayMode).toHaveBeenCalledWith("autocanonizer");
  });

  it("defaults a playlist track without a stored mode to jukebox", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    await handlers.loadPlaylistIndex(1);

    expect(deps.setPlayMode).toHaveBeenCalledWith("jukebox");
  });

  it("advances autocanonizer to the next playlist track when available", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    const advanced = await handlers.advanceAutocanonizerOnEnded();

    expect(advanced).toBe(true);
    expect(deps.loadTrackById).toHaveBeenCalledOnce();
    expect(togglePlayback).toHaveBeenCalledWith(deps.context);
  });

  it("does not report autocanonizer advance when the playlist load fails", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    deps.loadTrackById = vi.fn(async (): Promise<boolean> => false);
    const handlers = createPlaylistHandlers(deps);

    const advanced = await handlers.advanceAutocanonizerOnEnded();

    expect(advanced).toBe(false);
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not advance autocanonizer without a next playlist track", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 1 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    await expect(handlers.advanceAutocanonizerOnEnded()).resolves.toBe(false);
    expect(deps.loadTrackById).not.toHaveBeenCalled();
  });

  it("clears the playlist from the modal action", () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleClearPlaylist();

    expect(useAppStore.getState().playlist).toEqual(emptyPlaylist());
    expect(useAppStore.getState().playlistModalOpen).toBe(false);
  });
});
