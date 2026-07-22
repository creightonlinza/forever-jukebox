import type { MouseEvent } from "react";
import type { TabId } from "../context";
import { trackEvent } from "../analytics";
import { useAppStore } from "../store";
import { useTranslation } from "react-i18next";
import { pathForTab } from "../tabs";
import { SettingsButton } from "./Hero";

function tabClass(active: boolean, pulsing = false) {
  let cls = "tab-btn";
  if (active) cls += " active";
  if (pulsing) cls += " is-playing";
  return cls;
}

export function TabBar() {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.activeTabId);
  const isPlayTabPulsing = useAppStore((s) => s.isPlayTabPulsing);
  const selectTab = useAppStore((s) => s.selectTab);
  // Tabs are real links (crawlers only discover pages through anchor hrefs), but a
  // plain left click must stay an in-app store navigation, not a page load.
  const onClick = (tabId: TabId) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    selectTab(tabId);
  };
  return (
    <nav className="tabs" aria-label={t("navigation.primary")}>
      <a
        className={tabClass(activeTab === "top")}
        data-tab-button="top"
        href={pathForTab("top")}
        onClick={onClick("top")}
      >
        <span className="tab-label-top-full">{t("navigation.topTracks")}</span>
        <span className="tab-label-top-short">{t("navigation.top")}</span>
      </a>
      <a
        className={tabClass(activeTab === "search")}
        data-tab-button="search"
        href={pathForTab("search")}
        onClick={onClick("search")}
      >
        {t("common.search")}
      </a>
      <a
        className={tabClass(activeTab === "play", isPlayTabPulsing)}
        data-tab-button="play"
        href={pathForTab("play")}
        onClick={onClick("play")}
      >
        {t("common.listen")}
      </a>
      <a
        className={tabClass(activeTab === "faq")}
        data-tab-button="faq"
        href={pathForTab("faq")}
        onClick={onClick("faq")}
      >
        {t("common.faq")}
      </a>
      <a
        className="tab-btn tab-link"
        href="/offline/"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("open_pwa", { source: "tab_bar" })}
      >
        <span className="material-symbols-outlined tab-link-icon" aria-hidden="true">
          download
        </span>
        <span className="tab-label-offline-full">{t("navigation.offlineApp")}</span>
        <span className="tab-label-offline-short">{t("navigation.app")}</span>
      </a>
      <SettingsButton
        id="settings-open"
        className="settings-button settings-button-tab"
      />
    </nav>
  );
}
