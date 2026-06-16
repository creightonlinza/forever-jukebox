import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateFavoritesFromSync,
  updateFavorites,
} from "./favorites-actions";
import { configureMaxFavorites, maxFavorites } from "./favorites";
import { useAppStore } from "./store";
import { applyAppConfig } from "./app-config";

vi.mock("./favorites-actions", () => ({
  hydrateFavoritesFromSync: vi.fn(),
  updateFavorites: vi.fn(),
}));

const initialStoreState = useAppStore.getState();

describe("applyAppConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({ footerCredit: null });
  });

  it("applies configured max favorites and trims local state", () => {
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

    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      max_favorites: 2,
    });

    expect(maxFavorites()).toBe(2);
    expect(updateFavorites).toHaveBeenCalledWith(
      useAppStore.getState().favorites,
      { sync: false },
    );
  });

  it("publishes host credit with URL to the shell store", () => {
    applyAppConfig({
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
    applyAppConfig({
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
    applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      allow_favorites_sync: true,
    });

    expect(hydrateFavoritesFromSync).toHaveBeenCalledOnce();
  });

  it("skips favorites hydration when applying cached config", () => {
    applyAppConfig(
      {
        allow_user_upload: false,
        allow_user_url: false,
        allow_favorites_sync: true,
      },
      { hydrateFavorites: false },
    );

    expect(hydrateFavoritesFromSync).not.toHaveBeenCalled();
  });
});
