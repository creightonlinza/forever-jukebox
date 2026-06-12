import type { AppState } from "../context";
import { TOP_SONGS_LIMIT } from "../constants";
import type { Elements } from "../elements";
import { navigateToFaqSubtab, type FaqSubtabId } from "../tabs";
import type { FavoritesHandlers } from "./favorites";

type TopSongsTabId = "top" | "trending" | "recent" | "favorites";

type TabsDeps = {
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  onTopSongsTabChange?: (tabId: TopSongsTabId) => void;
  onTopSongsRefresh?: (tabId: TopSongsTabId) => void;
  onFaqOpen?: () => void;
};

export type TabsHandlers = ReturnType<typeof createTabsHandlers>;

export function createTabsHandlers(deps: TabsDeps) {
  const {
    elements,
    state,
    favoritesHandlers,
    onFaqOpen,
  } = deps;

  function setTopSongsTab(tabId: TopSongsTabId) {
    state.topSongsTab = tabId;
    elements.topSongsTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.topSubtab === tabId);
    });
    elements.topSongsList.classList.toggle("hidden", tabId !== "top");
    elements.trendingSongsList.classList.toggle("hidden", tabId !== "trending");
    elements.recentSongsList.classList.toggle("hidden", tabId !== "recent");
    elements.favoritesFilter.classList.toggle("hidden", tabId !== "favorites");
    elements.favoritesList.classList.toggle("hidden", tabId !== "favorites");
    elements.topListTitle.textContent =
      tabId === "top"
        ? `Top ${TOP_SONGS_LIMIT}`
        : tabId === "trending"
          ? "Trending"
        : tabId === "recent"
          ? `Last ${TOP_SONGS_LIMIT} Played`
          : "Favorites";
    elements.topListRefreshButton.classList.toggle(
      "hidden",
      tabId === "favorites",
    );
    elements.topListRefreshButton.setAttribute(
      "aria-label",
      `Refresh ${elements.topListTitle.textContent ?? "list"}`,
    );
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

  function setFaqTab(tabId: FaqSubtabId) {
    elements.faqSubtabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.faqSubtab === tabId);
    });
    elements.faqPanel.classList.toggle("hidden", tabId !== "faq");
    elements.faqWhatsNewPanel.classList.toggle("hidden", tabId !== "whats-new");
    elements.faqPanelTitle.textContent = tabId === "faq" ? "FAQ" : "What's New";
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

  function handleTopSongsRefreshClick() {
    deps.onTopSongsRefresh?.(state.topSongsTab);
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

  function handleFaqSubtabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.faqSubtab as FaqSubtabId | undefined;
    if (!tabId) {
      return;
    }
    setFaqTab(tabId);
    navigateToFaqSubtab(tabId);
    onFaqOpen?.();
  }

  return {
    setTopSongsTab,
    handleTopSongsTabClick,
    handleTopSongsRefreshClick,
    setSearchTab,
    handleSearchSubtabClick,
    setFaqTab,
    handleFaqSubtabClick,
  };
}
