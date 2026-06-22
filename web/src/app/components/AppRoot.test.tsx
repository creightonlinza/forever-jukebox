import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppRoot } from "./AppRoot";
import { useAppStore } from "../store";
import { tabFromPathname } from "../tabs";

const h = vi.hoisted(() => ({
  attachViz: vi.fn(),
  handleRoute: vi.fn(),
  applyTheme: vi.fn(),
  jukebox: {
    getCount: vi.fn(() => 6),
    resizeActive: vi.fn(),
    resizeNow: vi.fn(),
    setSelectedEdge: vi.fn(),
  },
  autocanonizer: {
    resizeNow: vi.fn(),
  },
  engine: {
    setForceBranch: vi.fn(),
  },
  fetchTopSongs: vi.fn(async () => []),
  fetchTrendingSongs: vi.fn(async () => []),
  fetchRecentSongs: vi.fn(async () => []),
  getCachedAudioBytes: vi.fn(async () => 0),
}));

vi.mock("../runtime", () => ({
  attachViz: h.attachViz,
  getAppContext: vi.fn(() => ({
    jukebox: h.jukebox,
    autocanonizer: h.autocanonizer,
    engine: h.engine,
  })),
  getAttachedAppContext: vi.fn(() => ({
    jukebox: h.jukebox,
    autocanonizer: h.autocanonizer,
    engine: h.engine,
  })),
  getVizPanel: vi.fn(() => null),
  handleRoute: h.handleRoute,
}));

vi.mock("../theme", () => ({
  applyTheme: h.applyTheme,
}));

vi.mock("../playback-ui", () => ({
  handleKeydown: vi.fn(),
  handleKeyup: vi.fn(),
  handleWindowBlur: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchTopSongs: h.fetchTopSongs,
  fetchTrendingSongs: h.fetchTrendingSongs,
  fetchRecentSongs: h.fetchRecentSongs,
}));

vi.mock("../cache", () => ({
  getCachedAudioBytes: h.getCachedAudioBytes,
  clearCachedAudio: vi.fn(async () => {}),
}));

const initialStoreState = useAppStore.getState();

function renderApp(initialPath = "/") {
  act(() => {
    useAppStore.getState().setActiveTab(tabFromPathname(initialPath));
  });
  const router = createMemoryRouter(
    [{ path: "*", element: <AppRoot /> }],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("AppRoot tab lifecycle", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState(initialStoreState, true);
      useAppStore.getState().resetTopSongsCache();
    });
    document.title = "The Forever Jukebox";
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.className = "";
  });

  it("unmounts inactive regular tabs while keeping Listen mounted", async () => {
    const router = renderApp("/");
    const listenPanel = document.querySelector('[data-tab-panel="play"]');
    const vizLayer = document.getElementById("viz-layer");

    expect(document.querySelector('[data-tab-panel="top"]')).not.toBeNull();
    expect(document.querySelector('[data-tab-panel="search"]')).toBeNull();
    expect(listenPanel?.classList.contains("hidden")).toBe(true);

    act(() => {
      useAppStore.getState().selectTab("search");
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/search");
      expect(document.querySelector('[data-tab-panel="top"]')).toBeNull();
      expect(document.querySelector('[data-tab-panel="search"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-tab-panel="play"]')).toBe(listenPanel);
    expect(document.getElementById("viz-layer")).toBe(vizLayer);

    act(() => {
      useAppStore.getState().selectTab("play");
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/listen");
      expect(document.querySelector('[data-tab-panel="search"]')).toBeNull();
      expect(
        document
          .querySelector('[data-tab-panel="play"]')
          ?.classList.contains("hidden"),
      ).toBe(false);
    });
    expect(document.querySelector('[data-tab-panel="play"]')).toBe(listenPanel);
    expect(document.getElementById("viz-layer")).toBe(vizLayer);
  });

  it("syncs the browser title from route and track state", async () => {
    const router = renderApp("/");
    await waitFor(() => {
      expect(document.title).toBe("Top Tracks | The Forever Jukebox");
    });

    act(() => {
      useAppStore.getState().selectTab("search");
    });
    await waitFor(() => {
      expect(document.title).toBe("Search | The Forever Jukebox");
    });

    act(() => {
      useAppStore.getState().selectTab("play");
    });
    await waitFor(() => {
      expect(document.title).toBe("Listen | The Forever Jukebox");
    });

    act(() => {
      useAppStore.setState({ trackTitle: "Song", trackArtist: "Artist" });
    });
    await waitFor(() => {
      expect(document.title).toBe("Song - Artist | The Forever Jukebox");
    });

    await act(async () => {
      await router.navigate("/whats-new");
    });
    await waitFor(() => {
      expect(document.title).toBe("What's New | The Forever Jukebox");
    });
  });
});
