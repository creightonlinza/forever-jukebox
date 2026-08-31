import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFavoritesSync,
  updateFavoritesSync,
  type AnalysisComplete,
} from "./api";
import type { AppContext } from "./context";
import {
  findCurrentFavorite,
  saveFavorites,
  type FavoriteTrack,
} from "./favorites";
import { setAppRuntime } from "./runtime";
import { useAppStore } from "./store";
import {
  maybeAutoFavoriteUserSupplied,
  resetFavoritesActionsForTest,
  toggleFavorite,
  updateFavorites,
} from "./favorites-actions";
import { DEFAULT_JUKEBOX_CONFIG } from "@forever-jukebox/shared";
import { syncTuningParamsState } from "./tuning";

vi.mock("./ui", () => ({ showToast: vi.fn() }));
// Keep the real canonicalizer (the drift check depends on it); stub only the
// engine-touching pieces.
vi.mock("./tuning", async (importActual) => ({
  ...(await importActual<typeof import("./tuning")>()),
  syncTuningParamsState: vi.fn(() => null),
  writeTuningParamsToUrl: vi.fn(),
}));
vi.mock("./api", () => ({
  fetchFavoritesSync: vi.fn(async () => []),
  createFavoritesSync: vi.fn(async () => ({})),
  updateFavoritesSync: vi.fn(async () => ({})),
}));
vi.mock("./favorites", async (importActual) => ({
  ...(await importActual<typeof import("./favorites")>()),
  saveFavorites: vi.fn(),
  saveFavoritesSyncCode: vi.fn(),
}));

type FakeElement = {
  className: string;
  textContent: string;
  innerHTML: string;
  title: string;
  dataset: Record<string, string>;
  classList: {
    add: (token: string) => void;
    remove: (token: string) => void;
    toggle: (token: string, force?: boolean) => boolean;
    contains: (token: string) => boolean;
  };
  append: (...children: unknown[]) => void;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (name: string, listener: EventListener) => void;
};

function createClassList() {
  const classes = new Set<string>();
  return {
    add: vi.fn((token: string) => {
      classes.add(token);
    }),
    remove: vi.fn((token: string) => {
      classes.delete(token);
    }),
    toggle: vi.fn((token: string, force?: boolean) => {
      const next = force ?? !classes.has(token);
      if (next) {
        classes.add(token);
      } else {
        classes.delete(token);
      }
      return next;
    }),
    contains: vi.fn((token: string) => classes.has(token)),
  };
}

function createFakeElement(): FakeElement {
  return {
    className: "",
    textContent: "",
    innerHTML: "",
    title: "",
    dataset: {},
    classList: createClassList(),
    append() {},
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
  };
}

const initialStoreState = useAppStore.getState();

function setupFavorites(favorites: FavoriteTrack[]) {
  const context = {
    defaultConfig: { ...DEFAULT_JUKEBOX_CONFIG },
  } as AppContext;
  setAppRuntime(context);
  useAppStore.setState(initialStoreState, true);
  useAppStore.setState({
    favorites,
    lastTrackId: "a3f3c0dc73c6476c9db95c227f9206f2",
    lastJobId: "a3f3c0dc73c6476c9db95c227f9206f2",
    lastSourceId: "abc123def45",
    lastSourceProvider: "youtube",
    trackTitle: "Song",
    trackArtist: "Artist",
    trackDurationSec: 123,
  });
}

function favorite(id: string): FavoriteTrack {
  return {
    uniqueSongId: id,
    title: id,
    artist: "",
    duration: null,
    sourceType: "youtube",
  };
}

async function flushMicrotasks(count = 5) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

describe("favorites actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so restore the factory default or a
    // per-test return value leaks into every test declared after it.
    vi.mocked(syncTuningParamsState).mockReturnValue(null);
    resetFavoritesActionsForTest();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => createFakeElement()),
    });
    vi.stubGlobal("window", {
      location: { href: "http://localhost/" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats an older YouTube favorite as active and migrates it to the job id", () => {
    setupFavorites([
      {
        uniqueSongId: "abc123def45",
        sourceType: "youtube",
        title: "Old Song",
        artist: "Old Artist",
        duration: null,
      },
    ]);
    const response = {
      status: "complete",
      id: "a3f3c0dc73c6476c9db95c227f9206f2",
      source_id: "abc123def45",
      source_provider: "youtube",
        result: {},
    } as AnalysisComplete;

    expect(
      findCurrentFavorite(useAppStore.getState().favorites, {
        lastTrackId: useAppStore.getState().lastTrackId,
        lastJobId: useAppStore.getState().lastJobId,
        lastSourceId: useAppStore.getState().lastSourceId,
        lastSourceProvider: useAppStore.getState().lastSourceProvider,
      }),
    ).not.toBeNull();
    maybeAutoFavoriteUserSupplied(response);

    expect(useAppStore.getState().favorites).toHaveLength(1);
    expect(useAppStore.getState().favorites[0].uniqueSongId).toBe(response.id);
    expect(useAppStore.getState().favorites[0].sourceType).toBe("youtube");
    expect(saveFavorites).toHaveBeenCalledWith(useAppStore.getState().favorites);
  });

  it("merges queued deltas instead of dropping them while a sync is in flight", async () => {
    // Each update call returns a controllable promise so we can hold the
    // first sync "in flight" while further local edits queue up behind it.
    const resolvers: Array<(value: { favorites?: FavoriteTrack[] }) => void> =
      [];
    const updateCalls: FavoriteTrack[][] = [];
    vi.mocked(updateFavoritesSync).mockImplementation(
      (_code: string, favorites: FavoriteTrack[]) => {
        updateCalls.push(favorites);
        return new Promise<{ favorites?: FavoriteTrack[] }>((resolve) => {
          resolvers.push(resolve);
        });
      },
    );
    // Server is empty throughout; the merged local delta is what matters.
    vi.mocked(fetchFavoritesSync).mockResolvedValue([]);
    setupFavorites([]);
    useAppStore.setState({
      appConfig: { allow_favorites_sync: true } as never,
      favoritesSyncCode: "code",
      favorites: [],
    });

    const a = favorite("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");
    const b = favorite("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2");

    updateFavorites([a]); // starts sync #1 (adds A)
    await flushMicrotasks();
    updateFavorites([a, b]); // queue: add B
    updateFavorites([b]); // queue: remove A — must MERGE with add B

    expect(updateCalls).toHaveLength(1);

    // Resolve sync #1, echoing what it pushed; this flushes the queued delta.
    resolvers[0]({ favorites: updateCalls[0] });
    await flushMicrotasks();

    // The second sync must carry B (queued add survived the later remove-A);
    // pre-fix the third edit replaced the second and B was lost.
    expect(updateCalls).toHaveLength(2);
    const ids = updateCalls[1].map((item) => item.uniqueSongId);
    expect(ids).toContain(b.uniqueSongId);
    expect(ids).not.toContain(a.uniqueSongId);
  });

  function enableSync() {
    useAppStore.setState({
      appConfig: { allow_favorites_sync: true } as never,
      favoritesSyncCode: "code",
    });
  }

  it("syncs an in-place tuning edit as an update", async () => {
    const a = { ...favorite("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"), tuningParams: "thresh=30" };
    const updateCalls: FavoriteTrack[][] = [];
    vi.mocked(updateFavoritesSync).mockImplementation(
      (_code: string, favorites: FavoriteTrack[]) => {
        updateCalls.push(favorites);
        return Promise.resolve({ favorites });
      },
    );
    vi.mocked(fetchFavoritesSync).mockResolvedValue([a]);
    setupFavorites([a]);
    enableSync();

    updateFavorites([{ ...a, tuningParams: "thresh=45" }]);
    await flushMicrotasks();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toHaveLength(1);
    expect(updateCalls[0][0].tuningParams).toBe("thresh=45");
    // The server echo must not clobber the edit back to the stale tuning.
    expect(useAppStore.getState().favorites[0].tuningParams).toBe("thresh=45");
  });

  it("re-adds an updated favorite the server no longer has", async () => {
    const a = { ...favorite("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"), tuningParams: "thresh=30" };
    const updateCalls: FavoriteTrack[][] = [];
    vi.mocked(updateFavoritesSync).mockImplementation(
      (_code: string, favorites: FavoriteTrack[]) => {
        updateCalls.push(favorites);
        return Promise.resolve({ favorites });
      },
    );
    vi.mocked(fetchFavoritesSync).mockResolvedValue([]);
    setupFavorites([a]);
    enableSync();

    updateFavorites([{ ...a, tuningParams: "thresh=45" }]);
    await flushMicrotasks();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].map((item) => item.uniqueSongId)).toEqual([
      a.uniqueSongId,
    ]);
    expect(useAppStore.getState().favorites).toHaveLength(1);
  });

  it("folds a queued update into a still-pending add", async () => {
    const resolvers: Array<(value: { favorites?: FavoriteTrack[] }) => void> =
      [];
    const updateCalls: FavoriteTrack[][] = [];
    vi.mocked(updateFavoritesSync).mockImplementation(
      (_code: string, favorites: FavoriteTrack[]) => {
        updateCalls.push(favorites);
        return new Promise<{ favorites?: FavoriteTrack[] }>((resolve) => {
          resolvers.push(resolve);
        });
      },
    );
    vi.mocked(fetchFavoritesSync).mockResolvedValue([]);
    setupFavorites([]);
    enableSync();
    useAppStore.setState({ favorites: [] });

    const a = favorite("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");
    const b = favorite("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2");

    updateFavorites([a]); // starts sync #1 (adds A)
    await flushMicrotasks();
    updateFavorites([a, b]); // queue: add B
    updateFavorites([a, { ...b, tuningParams: "jb=1" }]); // queue: edit B

    resolvers[0]({ favorites: updateCalls[0] });
    await flushMicrotasks();

    expect(updateCalls).toHaveLength(2);
    const pushedB = updateCalls[1].filter(
      (item) => item.uniqueSongId === b.uniqueSongId,
    );
    expect(pushedB).toHaveLength(1);
    expect(pushedB[0].tuningParams).toBe("jb=1");
  });

  it("updates a drifted favorite in place instead of removing it", async () => {
    // Legacy source-id favorite: the update must keep the stored id.
    const legacy = {
      ...favorite("abc123def45"),
      tuningParams: "thresh=30",
    };
    setupFavorites([legacy]);
    useAppStore.setState({
      analysisLoaded: true,
      playMode: "jukebox",
      tuningParams: "thresh=45",
    });
    vi.mocked(syncTuningParamsState).mockReturnValue("thresh=45");

    toggleFavorite();
    await flushMicrotasks();

    const favorites = useAppStore.getState().favorites;
    expect(favorites).toHaveLength(1);
    expect(favorites[0].uniqueSongId).toBe("abc123def45");
    expect(favorites[0].tuningParams).toBe("thresh=45");
  });

  it("keeps the saved tuning when only the play mode changed", async () => {
    const tuned = {
      ...favorite("a3f3c0dc73c6476c9db95c227f9206f2"),
      tuningParams: "jb=1&thresh=45",
    };
    setupFavorites([tuned]);
    useAppStore.setState({
      analysisLoaded: true,
      playMode: "autocanonizer",
      tuningParams: null,
    });

    toggleFavorite();
    await flushMicrotasks();

    const favorites = useAppStore.getState().favorites;
    expect(favorites).toHaveLength(1);
    expect(favorites[0].playMode).toBe("autocanonizer");
    // The mode switch alone must not discard the jukebox tuning.
    expect(favorites[0].tuningParams).toBe("jb=1&thresh=45");
  });

  it("still removes a favorite whose tuning matches", async () => {
    const a = {
      ...favorite("a3f3c0dc73c6476c9db95c227f9206f2"),
      tuningParams: "jb=1&thresh=45",
    };
    setupFavorites([a]);
    useAppStore.setState({
      analysisLoaded: true,
      playMode: "jukebox",
      // Same tuning spelled differently: equivalent, so the tap removes.
      tuningParams: "thresh=45&jb=1",
    });

    toggleFavorite();
    await flushMicrotasks();

    expect(useAppStore.getState().favorites).toHaveLength(0);
  });
});
