import type { AppBridge } from "../../bridge";
import { useAppStore } from "../../store";
import { PlayMenu } from "./PlayMenu";
import { StatusPanel } from "./StatusPanel";
import { VizContainer } from "./VizContainer";

// The Listen panel. It persists in the DOM permanently — visibility is
// class-only, driven by the active tab.
export function ListenPanel({ bridge }: { bridge: AppBridge }) {
  const activeTab = useAppStore((s) => s.activeTabId);
  return (
    <section
      className={
        activeTab === "play" ? "panel tab-panel" : "panel tab-panel hidden"
      }
      data-tab-panel="play"
    >
      <StatusPanel />
      <PlayMenu bridge={bridge} />
      <VizContainer bridge={bridge} />
    </section>
  );
}
