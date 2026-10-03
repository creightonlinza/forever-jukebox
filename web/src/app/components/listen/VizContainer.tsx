import { useCallback, useEffect, useRef } from "react";
import type { PlayMode } from "../../context";
import { attachViz, getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { ModifierBadges } from "../ModifierBadges";
import { BranchStatsPopup } from "./BranchStatsPopup";
import { PlayControls } from "./PlayControls";
import { VizBottomRight } from "./VizBottomRight";
import { VizInfo } from "./VizInfo";
import { VizTop } from "./VizTop";

const VIZ_CLASS_NAMES: Record<PlayMode, string> = {
  jukebox: "viz",
  autocanonizer: "viz is-canonizer",
  wubmachine: "viz is-wubmachine",
};

// Hosts the viz canvases. The #viz-layer/#canonizer-layer divs are bare,
// stable JSX nodes — React renders them once and NEVER remounts them (no
// keys, no conditional unmount; visibility is class-only), because the
// controllers hold canvas/WebGL state inside. The panel-level ref callback
// hands the nodes to init's attachViz, which constructs the
// controllers exactly once (StrictMode re-attaches are ignored there).
export function VizContainer() {
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioModePreparing = useAppStore((s) => s.audioModePreparing);
  const playMode = useAppStore((s) => s.playMode);
  const vizStatsPulseId = useAppStore((s) => s.vizStatsPulseId);
  const vizPanelRef = useRef<HTMLDivElement | null>(null);
  const vizLayerRef = useRef<HTMLDivElement | null>(null);
  const canonizerLayerRef = useRef<HTMLDivElement | null>(null);
  const wubMachineLayerRef = useRef<HTMLDivElement | null>(null);

  const visible = audioLoaded && analysisLoaded && !audioModePreparing;

  // Child refs attach before this parent ref, so the layer nodes are ready.
  const handlePanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      vizPanelRef.current = node;
      if (
        node &&
        vizLayerRef.current &&
        canonizerLayerRef.current &&
        wubMachineLayerRef.current
      ) {
        attachViz({
          vizPanel: node,
          vizLayer: vizLayerRef.current,
          canonizerLayer: canonizerLayerRef.current,
          wubMachineLayer: wubMachineLayerRef.current,
        });
      }
    },
    [],
  );

  // Observe the panel and resize both controllers, with a window-resize
  // fallback for older browsers without ResizeObserver.
  useEffect(() => {
    const panel = vizPanelRef.current;
    if (!panel) {
      return;
    }
    const handleResize = () => {
      const ctx = getAppContext();
      ctx.jukebox?.resizeNow();
      ctx.autocanonizer?.resizeNow();
      ctx.wubmachine?.resizeNow();
    };
    if (
      typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !==
      "undefined"
    ) {
      const observer = new ResizeObserver(() => {
        handleResize();
      });
      observer.observe(panel);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Resize the active controller when the viz becomes visible.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const ctx = getAppContext();
    if (playMode === "autocanonizer") {
      ctx.autocanonizer?.resizeNow();
    } else if (playMode === "wubmachine") {
      ctx.wubmachine?.resizeNow();
    } else {
      ctx.jukebox?.resizeActive();
    }
  }, [visible, playMode]);

  return (
    <div
      id="viz-panel"
      className={visible ? undefined : "hidden"}
      ref={handlePanelRef}
    >
      <div
        id="jukebox-viz"
        className={VIZ_CLASS_NAMES[playMode]}
      >
        <BranchStatsPopup />
        <ModifierBadges />
        <div className="viz-top">
          <VizTop />
        </div>
        <div id="viz-layer" className="viz-layer" ref={vizLayerRef}></div>
        <div
          id="canonizer-layer"
          className="canonizer-layer"
          ref={canonizerLayerRef}
        ></div>
        <div
          id="wubmachine-layer"
          className="wubmachine-layer"
          ref={wubMachineLayerRef}
        ></div>
        <div
          className={vizStatsPulseId > 0 ? "viz-bottom pulse" : "viz-bottom"}
          id="viz-stats"
          key={vizStatsPulseId}
        >
          <div className="viz-bottom-left">
            <div className="viz-play-controls">
              <PlayControls />
            </div>
            <div className="viz-info">
              <VizInfo />
            </div>
          </div>
          <div className="viz-bottom-right">
            <VizBottomRight />
          </div>
        </div>
      </div>
    </div>
  );
}
