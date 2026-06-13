import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import type { AnalysisComplete } from "../api";
import type { AppContext } from "../context";
import {
  addFavorite,
  findCurrentFavorite,
  isFavorite,
  removeFavorite,
  sortFavorites,
  type FavoriteTrack,
} from "../favorites";
import { createFavoritesHandlers } from "./favorites";

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

type HarnessOverrides = Partial<
  Parameters<typeof createFavoritesHandlers>[0]
>;

function createHarness(
  favorites: FavoriteTrack[],
  overrides: HarnessOverrides = {},
) {
  const context = {} as AppContext;
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
  const saveFavorites = vi.fn();
  const handlers = createFavoritesHandlers({
    context,
    showToast: vi.fn(),
    addFavorite,
    removeFavorite,
    isFavorite,
    sortFavorites,
    maxFavorites: () => 150,
    saveFavorites,
    saveFavoritesSyncCode: vi.fn(),
    fetchFavoritesSync: vi.fn(async () => []),
    createFavoritesSync: vi.fn(async () => ({})),
    updateFavoritesSync: vi.fn(async () => ({})),
    navigateToTabWithState: vi.fn(),
    loadTrackById: vi.fn(),
    loadTrackByJobId: vi.fn(),
    writeTuningParamsToUrl: vi.fn(),
    syncTuningParamsState: vi.fn(() => null),
    setPlayMode: vi.fn(),
    ...overrides,
  });
  return { handlers, saveFavorites };
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

describe("createFavoritesHandlers", () => {
  beforeEach(() => {
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

  it("treats a legacy YouTube favorite as active and migrates it to the job id", () => {
    const { handlers, saveFavorites } = createHarness([
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
    handlers.maybeAutoFavoriteUserSupplied(response);

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
    const updateFavoritesSync = vi.fn(
      (_code: string, favorites: FavoriteTrack[]) => {
        updateCalls.push(favorites);
        return new Promise<{ favorites?: FavoriteTrack[] }>((resolve) => {
          resolvers.push(resolve);
        });
      },
    );
    const { handlers } = createHarness([], {
      // Server is empty throughout; the merged local delta is what matters.
      fetchFavoritesSync: vi.fn(async () => []),
      updateFavoritesSync,
    });
    useAppStore.setState({
      appConfig: { allow_favorites_sync: true } as never,
      favoritesSyncCode: "code",
      favorites: [],
    });

    const a = favorite("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");
    const b = favorite("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2");

    handlers.updateFavorites([a]); // starts sync #1 (adds A)
    await flushMicrotasks();
    handlers.updateFavorites([a, b]); // queue: add B
    handlers.updateFavorites([b]); // queue: remove A — must MERGE with add B

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
});
