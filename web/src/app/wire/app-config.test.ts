import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureMaxFavorites, maxFavorites } from "../favorites";
import { useAppStore } from "../store";
import { createAppConfigHandlers } from "./app-config";

const initialStoreState = useAppStore.getState();

function createHarness() {
  useAppStore.setState(initialStoreState, true);
  const favoritesHandlers = {
    hydrateFavoritesFromSync: vi.fn(),
    updateFavorites: vi.fn(),
  };
  const handlers = createAppConfigHandlers({
    favoritesHandlers:
      favoritesHandlers as unknown as Parameters<
        typeof createAppConfigHandlers
      >[0]["favoritesHandlers"],
  });
  return { favoritesHandlers, handlers };
}

describe("createAppConfigHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
    useAppStore.setState({ footerCredit: null });
  });

  it("applies configured max favorites and trims local state", () => {
    const { favoritesHandlers, handlers } = createHarness();
    useAppStore.setState({
      favorites: [
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
    ]
    });

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      max_favorites: 2,
    });

    expect(maxFavorites()).toBe(2);
    expect(favoritesHandlers.updateFavorites).toHaveBeenCalledWith(
      useAppStore.getState().favorites,
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
  });
});
