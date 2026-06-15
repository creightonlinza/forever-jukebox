import { useCallback, useEffect, useRef } from "react";
import type { AppBridge } from "../../bridge";
import { useAppStore } from "../../store";
import { BranchStatsPopup } from "./BranchStatsPopup";
import { PlayControls } from "./PlayControls";
import { VizBottomRight } from "./VizBottomRight";
import { VizInfo } from "./VizInfo";
import { VizTop } from "./VizTop";

// Hosts the viz canvases. The #viz-layer/#canonizer-layer divs are bare,
// stable JSX nodes — React renders them once and NEVER remounts them (no
// keys, no conditional unmount; visibility is class-only), because the
// controllers hold canvas/WebGL state inside. The panel-level ref callback
// hands the nodes to bootstrap's attachViz, which constructs the
// controllers exactly once (StrictMode re-attaches are ignored there).
export function VizContainer({ bridge }: { bridge: AppBridge }) {
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const swingPreparing = useAppStore((s) => s.swingPreparing);
  const playMode = useAppStore((s) => s.playMode);
  const vizPanelRef = useRef<HTMLDivElement | null>(null);
  const vizLayerRef = useRef<HTMLDivElement | null>(null);
  const canonizerLayerRef = useRef<HTMLDivElement | null>(null);

  const visible = audioLoaded && analysisLoaded && !swingPreparing;

  // Child refs attach before this parent ref, so the layer nodes are ready.
  const handlePanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      vizPanelRef.current = node;
      if (node && vizLayerRef.current && canonizerLayerRef.current) {
        bridge.attachViz({
          vizPanel: node,
          vizLayer: vizLayerRef.current,
          canonizerLayer: canonizerLayerRef.current,
        });
      }
    },
    [bridge],
  );

  // Observe the panel and resize both controllers, with a window-resize
  // fallback for older browsers without ResizeObserver.
  useEffect(() => {
    const panel = vizPanelRef.current;
    if (!panel) {
      return;
    }
    const handleResize = () => {
      bridge.context.jukebox?.resizeNow();
      bridge.context.autocanonizer?.resizeNow();
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
  }, [bridge]);

  // Resize the active controller when the viz becomes visible.
  useEffect(() => {
    if (!visible) {
      return;
    }
    if (playMode === "autocanonizer") {
      bridge.context.autocanonizer?.resizeNow();
    } else {
      bridge.context.jukebox?.resizeActive();
    }
  }, [visible, playMode, bridge]);

  return (
    <div
      id="viz-panel"
      className={visible ? undefined : "hidden"}
      ref={handlePanelRef}
    >
      <div
        id="jukebox-viz"
        className={playMode === "autocanonizer" ? "viz is-canonizer" : "viz"}
      >
        <BranchStatsPopup bridge={bridge} />
        <div className="viz-top">
          <VizTop bridge={bridge} />
        </div>
        <div id="viz-layer" className="viz-layer" ref={vizLayerRef}></div>
        <div
          id="canonizer-layer"
          className="canonizer-layer"
          ref={canonizerLayerRef}
        ></div>
        <div className="viz-bottom" id="viz-stats">
          <div className="viz-bottom-left">
            <div className="viz-play-controls">
              <PlayControls bridge={bridge} />
            </div>
            <div className="viz-info">
              <VizInfo />
            </div>
          </div>
          <div className="viz-bottom-right">
            <VizBottomRight bridge={bridge} />
          </div>
        </div>
      </div>
    </div>
  );
}
