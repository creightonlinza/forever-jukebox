import type { TabId } from "./context";
import i18n from "./i18n";

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
      pageTitle = cleanTrackTitle || i18n.t("common.listen");
    }
  } else if (activeTabId === "search") {
    pageTitle = i18n.t("common.search");
  } else if (activeTabId === "faq") {
    pageTitle = pathname.startsWith("/whats-new")
      ? i18n.t("documentTitle.whatsNew")
      : i18n.t("common.faq");
  } else {
    // The homepage title is the bare brand name, matching the server-rendered
    // <title> so hydration doesn't swap it.
    return i18n.t("common.appName");
  }

  return i18n.t("documentTitle.separator", {
    page: pageTitle,
    app: i18n.t("common.appName"),
  });
}
