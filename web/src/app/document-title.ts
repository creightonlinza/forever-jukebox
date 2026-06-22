import type { TabId } from "./context";
import i18n from "./i18n";

export const BASE_DOCUMENT_TITLE = i18n.t("common.appName");

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
    pageTitle = i18n.t("navigation.topTracks");
  }

  return i18n.t("documentTitle.separator", {
    page: pageTitle,
    app: BASE_DOCUMENT_TITLE,
  });
}
