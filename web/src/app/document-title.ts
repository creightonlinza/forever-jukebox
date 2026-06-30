import type { TabId } from "./context";

export const BASE_DOCUMENT_TITLE = "Forever Jukebox";

export function titleForAppView({
  activeTabId,
  pathname,
  trackTitle,
  trackArtist,
}: {
  activeTabId: TabId;
  pathname: string;
  trackTitle: string | null;
  trackArtist: string | null;
}) {
  const cleanTrackTitle = trackTitle?.trim() ?? "";
  const cleanTrackArtist = trackArtist?.trim() ?? "";
  let pageTitle: string;

  if (activeTabId === "play") {
    if (cleanTrackTitle && cleanTrackArtist) {
      pageTitle = `${cleanTrackTitle} - ${cleanTrackArtist}`;
    } else {
      pageTitle = cleanTrackTitle || "Listen";
    }
  } else if (activeTabId === "search") {
    pageTitle = "Search";
  } else if (activeTabId === "faq") {
    pageTitle = pathname.startsWith("/whats-new") ? "What's New" : "FAQ";
  } else {
    pageTitle = "Top Tracks";
  }

  return `${pageTitle} | ${BASE_DOCUMENT_TITLE}`;
}
