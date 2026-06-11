import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppState } from "../context";
import { emptyPlaylist, type PlaylistTrack } from "../playlist";
import { createPlaylistHandlers } from "./playlist";
import { setWindowUrl } from "../__tests__/test-utils";

function createClassList(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: vi.fn((token: string) => classes.add(token)),
    remove: vi.fn((token: string) => classes.delete(token)),
    toggle: vi.fn((token: string, force?: boolean) => {
      if (force === true) {
        classes.add(token);
        return true;
      }
      if (force === false) {
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    }),
    contains: vi.fn((token: string) => classes.has(token)),
  };
}

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

function createButton() {
  return {
    classList: createClassList(),
    disabled: false,
    title: "",
    setAttribute: vi.fn(),
  } as unknown as HTMLButtonElement;
}

function createDeps(overrides?: Partial<AppState>) {
  const state = {
    playlist: emptyPlaylist(),
    lastTrackId: null,
    lastJobId: null,
    lastSourceProvider: null,
    trackTitle: null,
    trackArtist: null,
    trackDurationSec: null,
    playMode: "jukebox",
    tuningParams: null,
    audioLoaded: false,
    analysisLoaded: false,
    audioLoadInFlight: false,
    pollController: null,
    swingPreparing: false,
    isRunning: false,
    toastTimer: null,
    ...overrides,
  } as unknown as AppState;
  const elements = {
    playlistButton: createButton(),
    playlistPreviousButton: createButton(),
    playlistNextButton: createButton(),
    savedPlaylistButton: createButton(),
    playlistModal: {
      classList: createClassList(),
    },
    playlistList: {
      innerHTML: "",
      textContent: "",
    },
    playlistClearButton: createButton(),
  } as unknown as AppContext["elements"];
  const context = {
    state,
    elements,
  } as unknown as AppContext;
  return {
    context,
    elements,
    state,
    showToast: vi.fn(),
    loadTrackById: vi.fn(async () => {}),
    loadTrackByJobId: vi.fn(async () => {}),
    navigateToTabWithState: vi.fn(),
    togglePlayback: vi.fn(),
  };
}

describe("playlist handlers", () => {
  beforeEach(() => {
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
    expect(deps.state.playlist.tracks.map((item) => item.id)).toEqual([
      "current",
      "next",
    ]);

    handlers.handleAddToPlaylist(track("next"));
    expect(deps.showToast).toHaveBeenCalledWith(
      deps.context,
      "Already in playlist",
    );

    deps.state.playlist = {
      tracks: Array.from({ length: 10 }, (_, index) => track(`${index}`)),
      currentIndex: 0,
    };
    handlers.handleAddToPlaylist(track("extra"));
    expect(deps.showToast).toHaveBeenCalledWith(
      deps.context,
      "Playlist is full.",
    );
  });

  it("asks for a current track before starting a playlist", () => {
    const deps = createDeps();
    const handlers = createPlaylistHandlers(deps);

    handlers.handleAddToPlaylist(track("next"));

    expect(deps.showToast).toHaveBeenCalledWith(
      deps.context,
      "Load a track before starting a playlist.",
    );
  });

  it("clears inactive saved playlists on normal track selection", () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: -1 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleNormalTrackSelected(track("outside"));

    expect(deps.state.playlist).toEqual(emptyPlaylist());
  });

  it("replaces the active playlist item on normal track selection", () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 1 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    handlers.handleNormalTrackSelected(track("outside"));

    expect(deps.state.playlist.currentIndex).toBe(1);
    expect(deps.state.playlist.tracks.map((item) => item.id)).toEqual([
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

    deps.state.audioLoadInFlight = true;
    await handlers.loadPlaylistIndex(0);
    expect(deps.loadTrackById).toHaveBeenCalledTimes(1);
  });

  it("does not load or close the modal for the current playlist item", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    await handlers.loadPlaylistIndex(0, { closeModal: true });

    expect(deps.loadTrackById).not.toHaveBeenCalled();
    expect(deps.elements.playlistModal.classList.remove).not.toHaveBeenCalledWith(
      "open",
    );
  });

  it("closes the playlist modal immediately after selecting a playlist item", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    let resolveLoad: () => void = () => {};
    deps.loadTrackById = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const handlers = createPlaylistHandlers(deps);

    const loadPromise = handlers.loadPlaylistIndex(1, { closeModal: true });

    expect(deps.elements.playlistModal.classList.remove).toHaveBeenCalledWith(
      "open",
    );

    resolveLoad();
    await loadPromise;
  });

  it("advances autocanonizer to the next playlist track when available", async () => {
    const deps = createDeps({
      playlist: { tracks: [track("a"), track("b")], currentIndex: 0 },
    } as Partial<AppState>);
    const handlers = createPlaylistHandlers(deps);

    const advanced = await handlers.advanceAutocanonizerOnEnded();

    expect(advanced).toBe(true);
    expect(deps.loadTrackById).toHaveBeenCalledOnce();
    expect(deps.togglePlayback).toHaveBeenCalledWith(deps.context);
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

    expect(deps.state.playlist).toEqual(emptyPlaylist());
    expect(deps.elements.playlistModal.classList.remove).toHaveBeenCalledWith(
      "open",
    );
  });
});
