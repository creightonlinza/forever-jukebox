import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { MutableRefObject } from "react";
import type { AppBridge } from "../bridge";
import { TOP_SONGS_REFRESH_MS } from "../constants";
import { useShellStore } from "../shell-store";
import { tabFromPathname } from "../tabs";
import { Footer } from "./Footer";
import { Hero } from "./Hero";

// Derives activeTab from the URL on every location change and runs the
// legacy route handler (mode-from-URL, track loading, FAQ subtab sync) on
// initial load and browser back/forward. The location.key guard keeps
// StrictMode's double-invoked effects from loading a track twice.
function useRouteSync(bridge: AppBridge) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    useShellStore.getState().setActiveTab(tabFromPathname(location.pathname));
    if (navigationType === "POP" && handledKeyRef.current !== location.key) {
      handledKeyRef.current = location.key;
      bridge.handleRoute(location.pathname);
    }
  }, [location, navigationType, bridge]);
}

// Side effects formerly in tabs.ts setActiveTab, keyed on the derived
// activeTab. Panels stay in the DOM permanently; only `hidden` toggles.
function useTabEffects(
  bridge: AppBridge,
  panelsRef: MutableRefObject<HTMLDivElement | null>,
) {
  const activeTab = useShellStore((s) => s.activeTab);
  useEffect(() => {
    const { state, jukebox, engine } = bridge.context;
    state.activeTabId = activeTab;
    panelsRef.current
      ?.querySelectorAll<HTMLElement>("[data-tab-panel]")
      .forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.tabPanel !== activeTab);
      });
    useShellStore
      .getState()
      .setPlayTabPulsing(state.isRunning && activeTab !== "play");
    if (activeTab === "play") {
      jukebox.resizeActive();
    } else if (activeTab === "top") {
      if (state.topSongsRefreshTimer !== null) {
        window.clearTimeout(state.topSongsRefreshTimer);
      }
      state.topSongsRefreshTimer = window.setTimeout(() => {
        state.topSongsRefreshTimer = null;
      }, TOP_SONGS_REFRESH_MS);
    } else if (state.shiftBranching) {
      state.shiftBranching = false;
      engine.setForceBranch(false);
    }
    if (activeTab !== "play" && state.selectedEdge) {
      state.selectedEdge = null;
      jukebox.setSelectedEdge(null);
    }
  }, [activeTab, bridge, panelsRef]);
}

function useThemeEffect(bridge: AppBridge) {
  const theme = useShellStore((s) => s.theme);
  useEffect(() => {
    bridge.applyTheme(theme);
  }, [theme, bridge]);
}

export function AppRoot({
  bridge,
  legacyContent,
}: {
  bridge: AppBridge;
  legacyContent: DocumentFragment;
}) {
  const panelsRef = useRef<HTMLDivElement | null>(null);
  useRouteSync(bridge);
  useTabEffects(bridge, panelsRef);
  useThemeEffect(bridge);
  // Passthrough container: adopts the legacy panel/modal DOM nodes from
  // index.html. Imperative code keeps element references into this subtree,
  // so React must never re-render inside it. Adoption is idempotent — the
  // fragment empties on first attach and StrictMode re-attaches the same div.
  const adoptLegacy = useCallback(
    (node: HTMLDivElement | null) => {
      panelsRef.current = node;
      if (node && legacyContent.childNodes.length > 0) {
        node.appendChild(legacyContent);
      }
    },
    [legacyContent],
  );
  return (
    <>
      <Hero bridge={bridge} />
      <div ref={adoptLegacy} />
      <Footer />
    </>
  );
}
