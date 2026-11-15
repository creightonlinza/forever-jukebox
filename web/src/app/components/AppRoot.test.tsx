import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppRoot, lazyImports } from "./AppRoot";
import { useAppStore } from "../store";
import { tabFromPathname } from "../tabs";
import { handleWindowBlur } from "../playback-ui";

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
    // A value no route produces, so title assertions prove the sync ran.
    document.title = "pre-sync";
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
      expect(document.title).toBe("Forever Jukebox");
    });

    act(() => {
      useAppStore.getState().selectTab("search");
    });
    await waitFor(() => {
      expect(document.title).toBe("Search | Forever Jukebox");
    });

    act(() => {
      useAppStore.getState().selectTab("play");
    });
    await waitFor(() => {
      expect(document.title).toBe("Listen | Forever Jukebox");
    });

    act(() => {
      useAppStore.setState({ trackTitle: "Song", trackArtist: "Artist" });
    });
    await waitFor(() => {
      expect(document.title).toBe("Song - Artist | Forever Jukebox");
    });

    await act(async () => {
      await router.navigate("/whats-new");
    });
    await waitFor(() => {
      expect(document.title).toBe("What's New | Forever Jukebox");
    });
  });

  it("resets playback modifiers when the tab is hidden", () => {
    renderApp("/");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(handleWindowBlur).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
    expect(handleWindowBlur).toHaveBeenCalledTimes(1);
  });

  it("opens global settings from the header gear", async () => {
    renderApp("/");
    const button = document.getElementById("settings-open");
    expect(button?.getAttribute("aria-label")).toBe("Open settings");

    await userEvent.click(button!);

    expect(useAppStore.getState().settingsModalOpen).toBe(true);
    await waitFor(() => {
      expect(document.getElementById("settings-modal")?.className).toBe(
        "modal open",
      );
    });
    expect(document.activeElement?.id).toBe("settings-close");
  });

  it("mounts each modal on its first open and keeps it mounted after close", async () => {
    renderApp("/");
    const modalIds = [
      "tuning-modal",
      "settings-modal",
      "feedback-modal",
      "info-modal",
      "playlist-modal",
    ];
    for (const id of modalIds) {
      expect(document.getElementById(id)).toBeNull();
    }

    act(() => {
      useAppStore.setState({ infoModalOpen: true });
    });
    await waitFor(() => {
      expect(document.getElementById("info-modal")?.className).toBe(
        "modal open",
      );
    });
    const infoModal = document.getElementById("info-modal");

    act(() => {
      useAppStore.setState({ infoModalOpen: false });
    });
    expect(document.getElementById("info-modal")).toBe(infoModal);
    expect(infoModal?.className).toBe("modal");
    for (const id of modalIds.filter((id) => id !== "info-modal")) {
      expect(document.getElementById(id)).toBeNull();
    }
  });

  it("warms every lazy chunk once idle after mount and cancels on unmount", () => {
    let onIdle: (() => void) | undefined;
    const requestIdle = vi.fn((callback: () => void) => {
      onIdle = callback;
      return 7;
    });
    const cancelIdle = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdle);
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    const imports = lazyImports as Record<string, () => Promise<unknown>>;
    const loads = Object.keys(imports).map((key) =>
      vi.spyOn(imports, key).mockResolvedValue({}),
    );
    try {
      renderApp("/");
      expect(requestIdle).toHaveBeenCalledTimes(1);
      expect(loads).toHaveLength(7);
      for (const load of loads) {
        expect(load).not.toHaveBeenCalled();
      }

      onIdle?.();
      for (const load of loads) {
        expect(load).toHaveBeenCalledTimes(1);
      }

      cleanup();
      expect(cancelIdle).toHaveBeenCalledWith(7);
    } finally {
      for (const load of loads) {
        load.mockRestore();
      }
      vi.unstubAllGlobals();
    }
  });

  it("renders nothing for a lazy chunk that fails to load and keeps the app running", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("./FaqPanel", () => {
      throw new Error("chunk not found");
    });
    try {
      // Fresh modules give AppRoot a lazy FaqPanel that has not resolved yet.
      const { AppRoot: FreshAppRoot } = await import("./AppRoot");
      const { useAppStore: freshStore } = await import("../store");
      act(() => {
        freshStore.getState().setActiveTab("faq");
      });
      const router = createMemoryRouter(
        [{ path: "*", element: <FreshAppRoot /> }],
        { initialEntries: ["/faq"] },
      );
      render(<RouterProvider router={router} />);
      const listenPanel = document.querySelector('[data-tab-panel="play"]');
      expect(listenPanel).not.toBeNull();

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalled();
      });
      expect(document.querySelector('[data-tab-panel="faq"]')).toBeNull();
      expect(document.querySelector('[data-tab-panel="play"]')).toBe(
        listenPanel,
      );
      expect(document.getElementById("settings-open")).not.toBeNull();

      act(() => {
        freshStore.getState().selectTab("search");
      });
      await waitFor(() => {
        expect(
          document.querySelector('[data-tab-panel="search"]'),
        ).not.toBeNull();
      });
    } finally {
      vi.doUnmock("./FaqPanel");
      consoleError.mockRestore();
    }
  });
});
