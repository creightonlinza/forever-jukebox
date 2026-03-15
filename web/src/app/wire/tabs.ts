import type { AppState, TabId } from "../context";
import { TOP_SONGS_LIMIT } from "../constants";
import type { Elements } from "../elements";
import type { FavoritesHandlers } from "./favorites";

type TabsDeps = {
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; youtubeId?: string | null },
  ) => void;
  onTopSongsTabChange?: (tabId: "top" | "trending" | "recent" | "favorites") => void;
  onFaqOpen?: () => void;
};

export type TabsHandlers = ReturnType<typeof createTabsHandlers>;

export function createTabsHandlers(deps: TabsDeps) {
  const {
    elements,
    state,
    favoritesHandlers,
    navigateToTabWithState,
    onFaqOpen,
  } = deps;

  function setTopSongsTab(tabId: "top" | "trending" | "recent" | "favorites") {
    state.topSongsTab = tabId;
    elements.topSongsTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.topSubtab === tabId);
    });
    elements.topSongsList.classList.toggle("hidden", tabId !== "top");
    elements.trendingSongsList.classList.toggle("hidden", tabId !== "trending");
    elements.recentSongsList.classList.toggle("hidden", tabId !== "recent");
    elements.favoritesList.classList.toggle("hidden", tabId !== "favorites");
    elements.topListTitle.textContent =
      tabId === "top"
        ? `Top ${TOP_SONGS_LIMIT}`
        : tabId === "trending"
          ? "Trending"
        : tabId === "recent"
          ? `Last ${TOP_SONGS_LIMIT} Played`
          : "Favorites";
    favoritesHandlers.closeFavoritesSyncMenu();
    favoritesHandlers.updateFavoritesSyncControls();
    deps.onTopSongsTabChange?.(tabId);
  }

  function setSearchTab(tabId: "search" | "upload") {
    state.searchTab = tabId;
    elements.searchSubtabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.searchSubtab === tabId);
    });
    elements.searchPanel.classList.toggle("hidden", tabId !== "search");
    elements.uploadPanel.classList.toggle("hidden", tabId !== "upload");
    elements.searchPanelTitle.textContent =
      tabId === "search" ? "Search" : "Upload";
  }

  function handleTopSongsTabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.topSubtab as
      | "top"
      | "trending"
      | "recent"
      | "favorites"
      | undefined;
    if (!tabId) {
      return;
    }
    setTopSongsTab(tabId);
  }

  function handleSearchSubtabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.searchSubtab as
      | "search"
      | "upload"
      | undefined;
    if (!tabId) {
      return;
    }
    setSearchTab(tabId);
  }

  function handleTabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.tabButton as TabId | undefined;
    if (!tabId) {
      return;
    }
    if (tabId === "top") {
      setTopSongsTab("top");
    }
    if (tabId === "search") {
      setSearchTab("search");
    }
    navigateToTabWithState(tabId);
    if (tabId === "faq") {
      onFaqOpen?.();
    }
  }

  return {
    setTopSongsTab,
    handleTopSongsTabClick,
    setSearchTab,
    handleSearchSubtabClick,
    handleTabClick,
  };
}
