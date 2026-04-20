import type { AppContext, TabId } from "./context";
import { TOP_SONGS_REFRESH_MS } from "./constants";
import { serializeParams } from "./tuning";

export type FaqSubtabId = "faq" | "whats-new";

export function pathForTab(tabId: TabId, youtubeId?: string | null) {
  if (tabId === "search") {
    return "/search";
  }
  if (tabId === "play") {
    if (youtubeId) {
      return `/listen/${encodeURIComponent(youtubeId)}`;
    }
    return "/listen";
  }
  if (tabId === "faq") {
    return "/faq";
  }
  return "/";
}

export function pathForFaqSubtab(subtabId: FaqSubtabId) {
  return subtabId === "whats-new" ? "/whats-new" : "/faq";
}

export function setActiveTab(
  context: AppContext,
  tabId: TabId,
  onTopRefresh: () => void
) {
  const { elements, jukebox, engine, state } = context;
  state.activeTabId = tabId;
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
  });
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tabButton === tabId);
  });
  elements.playTabButton.classList.toggle(
    "is-playing",
    state.isRunning && tabId !== "play"
  );
  if (tabId === "play") {
    jukebox.resizeActive();
  } else if (tabId === "top") {
    if (state.topSongsRefreshTimer !== null) {
      window.clearTimeout(state.topSongsRefreshTimer);
    }
    state.topSongsRefreshTimer = window.setTimeout(() => {
      state.topSongsRefreshTimer = null;
      onTopRefresh();
    }, TOP_SONGS_REFRESH_MS);
  } else if (state.shiftBranching) {
    state.shiftBranching = false;
    engine.setForceBranch(false);
  }
  if (tabId !== "play" && state.selectedEdge) {
    state.selectedEdge = null;
    jukebox.setSelectedEdge(null);
  }
}

export function navigateToTab(
  tabId: TabId,
  options?: { replace?: boolean; youtubeId?: string | null },
  lastYouTubeId?: string | null,
  tuningParams?: string | null,
  playMode?: "jukebox" | "autocanonizer"
) {
  const path = pathForTab(tabId, options?.youtubeId ?? lastYouTubeId);
  const url = new URL(window.location.href);
  url.pathname = path;
  url.search = tabId === "play" ? buildSearchParams(tuningParams, playMode) : "";
  if (options?.replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function navigateToFaqSubtab(
  subtabId: FaqSubtabId,
  options?: { replace?: boolean },
) {
  const url = new URL(window.location.href);
  url.pathname = pathForFaqSubtab(subtabId);
  url.search = "";
  if (options?.replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function updateTrackUrl(
  youtubeId: string,
  replace = false,
  tuningParams?: string | null,
  playMode?: "jukebox" | "autocanonizer"
) {
  const url = new URL(window.location.href);
  url.pathname = pathForTab("play", youtubeId);
  url.search = buildSearchParams(tuningParams, playMode);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

function buildSearchParams(
  tuningParams?: string | null,
  playMode?: "jukebox" | "autocanonizer",
) {
  const params =
    playMode === "autocanonizer"
      ? new URLSearchParams()
      : new URLSearchParams(tuningParams ?? "");
  if (playMode === "autocanonizer") {
    params.set("mode", "autocanonizer");
  } else {
    params.delete("mode");
  }
  const search = serializeParams(params);
  return search ? `?${search}` : "";
}
