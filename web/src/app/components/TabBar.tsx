import type { AppBridge } from "../bridge";
import type { TabId } from "../context";
import { useShellStore } from "../shell-store";

function tabClass(active: boolean, pulsing = false) {
  let cls = "tab-btn";
  if (active) cls += " active";
  if (pulsing) cls += " is-playing";
  return cls;
}

export function TabBar({ bridge }: { bridge: Pick<AppBridge, "onTabClick"> }) {
  const activeTab = useShellStore((s) => s.activeTab);
  const isPlayTabPulsing = useShellStore((s) => s.isPlayTabPulsing);
  const onClick = (tabId: TabId) => () => bridge.onTabClick(tabId);
  return (
    <nav className="tabs" aria-label="Primary">
      <button
        className={tabClass(activeTab === "top")}
        data-tab-button="top"
        onClick={onClick("top")}
      >
        <span className="tab-label-top-full">Top Tracks</span>
        <span className="tab-label-top-short">Top</span>
      </button>
      <button
        className={tabClass(activeTab === "search")}
        data-tab-button="search"
        onClick={onClick("search")}
      >
        Search
      </button>
      <button
        className={tabClass(activeTab === "play", isPlayTabPulsing)}
        data-tab-button="play"
        onClick={onClick("play")}
      >
        Listen
      </button>
      <button
        className={tabClass(activeTab === "faq")}
        data-tab-button="faq"
        onClick={onClick("faq")}
      >
        FAQ
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
        <span className="tab-label-offline-full">Offline App</span>
        <span className="tab-label-offline-short">App</span>
      </a>
    </nav>
  );
}
