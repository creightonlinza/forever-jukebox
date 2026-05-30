import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../context";
import type { Elements } from "../elements";
import { configureMaxFavorites, maxFavorites } from "../favorites";
import { createAppConfigHandlers } from "./app-config";

function createClassList() {
  return {
    toggle: vi.fn(),
  };
}

function createElement(tagName: string) {
  return {
    tagName: tagName.toUpperCase(),
    href: "",
    target: "",
    rel: "",
    textContent: "",
  };
}

function createTextNode(text: string) {
  return {
    textContent: text,
  };
}

function createFooterCredit() {
  const children: Array<{ textContent?: string; href?: string }> = [];
  const ownerDocument = {
    createElement,
    createTextNode,
  };
  return {
    ownerDocument,
    children,
    textContent: "",
    appendChild: vi.fn((child: { textContent?: string; href?: string }) => {
      children.push(child);
      return child;
    }),
  } as unknown as HTMLParagraphElement & {
    children: Array<{ textContent?: string; href?: string }>;
  };
}

function createHarness() {
  const footerCredit = createFooterCredit();
  const elements = {
    footerCredit,
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
  return { favoritesHandlers, footerCredit, handlers, state };
}

describe("createAppConfigHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMaxFavorites(null);
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

  it("renders host credit as a footer link when name and URL are configured", () => {
    const { footerCredit, handlers } = createHarness();

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
      hosted_by_url: "https://example.com",
    });

    expect(footerCredit.children.map((child) => child.textContent).join("")).toBe(
      "The Forever Jukebox & Analysis Engine by Creighton. This instance is hosted by Example Host.",
    );
    expect(footerCredit.children.filter((child) => child.href)).toEqual([
      expect.objectContaining({ href: "https://creighton.dev" }),
      expect.objectContaining({ href: "https://example.com" }),
    ]);
  });

  it("renders host credit as text when no URL is configured", () => {
    const { footerCredit, handlers } = createHarness();

    handlers.applyAppConfig({
      allow_user_upload: false,
      allow_user_url: false,
      hosted_by_name: "Example Host",
    });

    expect(footerCredit.children.map((child) => child.textContent).join("")).toBe(
      "The Forever Jukebox & Analysis Engine by Creighton. This instance is hosted by Example Host.",
    );
    expect(footerCredit.children.filter((child) => child.href)).toEqual([
      expect.objectContaining({ href: "https://creighton.dev" }),
    ]);
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
