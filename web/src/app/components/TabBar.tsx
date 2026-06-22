import type { TabId } from "../context";
import { useAppStore } from "../store";
import { useTranslation } from "react-i18next";

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
  const onClick = (tabId: TabId) => () => selectTab(tabId);
  return (
    <nav className="tabs" aria-label={t("navigation.primary")}>
      <button
        className={tabClass(activeTab === "top")}
        data-tab-button="top"
        onClick={onClick("top")}
      >
        <span className="tab-label-top-full">{t("navigation.topTracks")}</span>
        <span className="tab-label-top-short">{t("navigation.top")}</span>
      </button>
      <button
        className={tabClass(activeTab === "search")}
        data-tab-button="search"
        onClick={onClick("search")}
      >
        {t("common.search")}
      </button>
      <button
        className={tabClass(activeTab === "play", isPlayTabPulsing)}
        data-tab-button="play"
        onClick={onClick("play")}
      >
        {t("common.listen")}
      </button>
      <button
        className={tabClass(activeTab === "faq")}
        data-tab-button="faq"
        onClick={onClick("faq")}
      >
        {t("common.faq")}
      </button>
      <a
        className="tab-btn tab-link"
        href="/offline/"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="material-symbols-outlined tab-link-icon" aria-hidden="true">
          download
        </span>
        <span className="tab-label-offline-full">{t("navigation.offlineApp")}</span>
        <span className="tab-label-offline-short">{t("navigation.app")}</span>
      </a>
    </nav>
  );
}
