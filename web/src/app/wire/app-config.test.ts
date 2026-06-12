import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../context";
import type { Elements } from "../elements";
import { configureMaxFavorites, maxFavorites } from "../favorites";
import { useAppStore } from "../store";
import { createAppConfigHandlers } from "./app-config";

function createClassList() {
  return {
    toggle: vi.fn(),
  };
}

function createHarness() {
  const elements = {
    searchSubtabs: { classList: createClassList() },
    uploadFileSection: { classList: createClassList() },
    uploadYoutubeSection: { classList: createClassList() },
    uploadFileHint: { textContent: "" },
    uploadFileInput: { accept: "" },
  } as unknown as Elements;
  const state = {
    searchTab: "search",
    appConfig: null,
    favorites: [],
  } as unknown as AppState;
  const favoritesHandlers = {
    updateFavoritesSyncControls: vi.fn(),
    hydrateFavoritesFromSync: vi.fn(),
    updateFavorites: vi.fn(),
  };
  const tabsHandlers = {
    setSearchTab: vi.fn(),
  };
  const handlers = createAppConfigHandlers({
    elements,
    state,
    favoritesHandlers:
      favoritesHandlers as unknown as Parameters<
        typeof createAppConfigHandlers
      >[0]["favoritesHandlers"],
    tabsHandlers,
  });
  return { favoritesHandlers, handlers, state };
}

describe("createAppConfigHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
    useAppStore.setState({ footerCredit: null });
  });

  it("applies configured max favorites and trims local state", () => {
    const { favoritesHandlers, handlers, state } = createHarness();
    state.favorites = [
      {
        uniqueSongId: "1",
        title: "A",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
      {
        uniqueSongId: "2",
        title: "B",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
      {
        uniqueSongId: "3",
        title: "C",
        artist: "Artist",
        duration: null,
        sourceType: "youtube",
      },
    ];

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      max_favorites: 2,
    });

    expect(maxFavorites()).toBe(2);
    expect(favoritesHandlers.updateFavorites).toHaveBeenCalledWith(
      state.favorites,
      { sync: false },
    );
  });

  it("publishes host credit with URL to the shell store", () => {
    const { handlers } = createHarness();

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
      hosted_by_url: "https://example.com",
    });

    expect(useAppStore.getState().footerCredit).toEqual({
      hostedByName: "Example Host",
      hostedByUrl: "https://example.com",
    });
  });

  it("publishes host credit without URL to the shell store", () => {
    const { handlers } = createHarness();

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
    });

    expect(useAppStore.getState().footerCredit).toEqual({
      hostedByName: "Example Host",
      hostedByUrl: null,
    });
  });

  it("hydrates favorites when fresh config allows sync", () => {
    const { favoritesHandlers, handlers } = createHarness();

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      allow_favorites_sync: true,
    });

    expect(favoritesHandlers.hydrateFavoritesFromSync).toHaveBeenCalledOnce();
  });

  it("skips favorites hydration when applying cached config", () => {
    const { favoritesHandlers, handlers } = createHarness();

    handlers.applyAppConfig(
      {
        allow_user_upload: false,
        allow_user_url: false,
        allow_favorites_sync: true,
      },
      { hydrateFavorites: false },
    );

    expect(favoritesHandlers.hydrateFavoritesFromSync).not.toHaveBeenCalled();
    expect(favoritesHandlers.updateFavoritesSyncControls).toHaveBeenCalledOnce();
  });
});
