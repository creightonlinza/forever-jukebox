import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../context";
import type { Elements } from "../elements";
import type { FavoritesHandlers } from "./favorites";
import { createTabsHandlers } from "./tabs";

function createMutableClassList(initial: string[] = []) {
  const classes = new Set(initial);
  return {
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

function createHarness() {
  const state = {
    topSongsTab: "top",
  } as AppState;
  const topSongsTabs = ["top", "trending", "recent", "favorites"].map(
    (tabId) =>
      ({
        dataset: { topSubtab: tabId },
        classList: createMutableClassList(tabId === "top" ? ["active"] : []),
      }) as unknown as HTMLButtonElement,
  );
  const topListRefreshButton = {
    classList: createMutableClassList(),
    setAttribute: vi.fn(),
  } as unknown as HTMLButtonElement;
  const elements = {
    topSongsTabs,
    topSongsList: { classList: createMutableClassList() },
    trendingSongsList: { classList: createMutableClassList(["hidden"]) },
    recentSongsList: { classList: createMutableClassList(["hidden"]) },
    favoritesFilter: { classList: createMutableClassList(["hidden"]) },
    favoritesList: { classList: createMutableClassList(["hidden"]) },
    topListTitle: { textContent: "" },
    topListRefreshButton,
  } as unknown as Elements;
  const favoritesHandlers = {
    closeFavoritesSyncMenu: vi.fn(),
    updateFavoritesSyncControls: vi.fn(),
  } as unknown as FavoritesHandlers;
  const onTopSongsTabChange = vi.fn();
  const onTopSongsRefresh = vi.fn();
  const handlers = createTabsHandlers({
    elements,
    state,
    favoritesHandlers,
    navigateToTabWithState: vi.fn(),
    onTopSongsTabChange,
    onTopSongsRefresh,
  });

  return {
    elements,
    handlers,
    onTopSongsRefresh,
    onTopSongsTabChange,
    state,
    topListRefreshButton,
  };
}

describe("createTabsHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the top list refresh control for refreshable subtabs", () => {
    const { handlers, onTopSongsTabChange, topListRefreshButton } =
      createHarness();

    handlers.setTopSongsTab("recent");

    expect(onTopSongsTabChange).toHaveBeenCalledWith("recent");
    expect(topListRefreshButton.classList.toggle).toHaveBeenCalledWith(
      "hidden",
      false,
    );
    expect(topListRefreshButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Refresh Last 25 Played",
    );
  });

  it("hides the top list refresh control on favorites", () => {
    const { handlers, topListRefreshButton } = createHarness();

    handlers.setTopSongsTab("favorites");

    expect(topListRefreshButton.classList.toggle).toHaveBeenCalledWith(
      "hidden",
      true,
    );
  });

  it("refreshes the currently active top songs subtab", () => {
    const { handlers, onTopSongsRefresh } = createHarness();

    handlers.setTopSongsTab("trending");
    handlers.handleTopSongsRefreshClick();

    expect(onTopSongsRefresh).toHaveBeenCalledWith("trending");
  });
});
