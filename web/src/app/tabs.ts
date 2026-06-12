import type { TabId } from "./context";
import { appNavigate } from "./router";
import { serializeParams } from "./tuning";

export type FaqSubtabId = "faq" | "whats-new";

export function pathForTab(tabId: TabId, trackId?: string | null) {
  if (tabId === "search") {
    return "/search";
  }
  if (tabId === "play") {
    if (trackId) {
      return `/listen/${encodeURIComponent(trackId)}`;
    }
    return "/listen";
  }
  if (tabId === "faq") {
    return "/faq";
  }
  return "/";
}

export function tabFromPathname(pathname: string): TabId {
  if (pathname.startsWith("/search")) {
    return "search";
  }
  if (pathname.startsWith("/listen")) {
    return "play";
  }
  if (pathname.startsWith("/faq") || pathname.startsWith("/whats-new")) {
    return "faq";
  }
  return "top";
}

export function urlForTrack(
  trackId: string,
  baseUrl: string,
  tuningParams?: string | null,
  playMode?: "jukebox" | "autocanonizer",
) {
  const url = new URL(pathForTab("play", trackId), baseUrl);
  url.search = buildSearchParams(tuningParams, playMode);
  return url.toString();
}

export function pathForFaqSubtab(subtabId: FaqSubtabId) {
  return subtabId === "whats-new" ? "/whats-new" : "/faq";
}

export function navigateToTab(
  tabId: TabId,
  options?: { replace?: boolean; trackId?: string | null },
  lastTrackId?: string | null,
  tuningParams?: string | null,
  playMode?: "jukebox" | "autocanonizer"
) {
  const path = pathForTab(
    tabId,
    options && "trackId" in options ? options.trackId : lastTrackId,
  );
  const url = new URL(window.location.href);
  url.pathname = path;
  url.search = tabId === "play" ? buildSearchParams(tuningParams, playMode) : "";
  appNavigate(url.pathname + url.search, { replace: options?.replace });
}

export function navigateToFaqSubtab(
  subtabId: FaqSubtabId,
  options?: { replace?: boolean },
) {
  appNavigate(pathForFaqSubtab(subtabId), { replace: options?.replace });
}

export function updateTrackUrl(
  trackId: string,
  replace = false,
  tuningParams?: string | null,
  playMode?: "jukebox" | "autocanonizer"
) {
  const url = new URL(
    urlForTrack(trackId, window.location.href, tuningParams, playMode),
  );
  appNavigate(url.pathname + url.search, { replace });
}

export function buildSearchParams(
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
