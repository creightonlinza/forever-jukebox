import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisComplete } from "../api";
import type { AppContext, AppState } from "../context";
import type { Elements } from "../elements";
import {
  addFavorite,
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

function createHarness(favorites: FavoriteTrack[]) {
  const context = {} as AppContext;
  const favoriteButton = createFakeElement();
  const state = {
    favorites,
    lastTrackId: "a3f3c0dc73c6476c9db95c227f9206f2",
    lastJobId: "a3f3c0dc73c6476c9db95c227f9206f2",
    lastSourceId: "abc123def45",
    lastSourceProvider: "youtube",
    trackTitle: "Song",
    trackArtist: "Artist",
    trackDurationSec: 123,
    playMode: "jukebox",
    appConfig: null,
    favoritesSyncCode: null,
  } as unknown as AppState;
  const elements = {
    favoriteButton,
    favoritesList: createFakeElement(),
    favoritesSearchInput: { value: "" },
  } as unknown as Elements;
  const saveFavorites = vi.fn();
  const handlers = createFavoritesHandlers({
    context,
    elements,
    state,
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
  });
  return { favoriteButton, handlers, saveFavorites, state };
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
    const { favoriteButton, handlers, saveFavorites, state } = createHarness([
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

    handlers.syncFavoriteButton();
    handlers.maybeAutoFavoriteUserSupplied(response);

    expect(favoriteButton.classList.toggle).toHaveBeenCalledWith("active", true);
    expect(state.favorites).toHaveLength(1);
    expect(state.favorites[0].uniqueSongId).toBe(response.id);
    expect(state.favorites[0].sourceType).toBe("youtube");
    expect(saveFavorites).toHaveBeenCalledWith(state.favorites);
  });
});
