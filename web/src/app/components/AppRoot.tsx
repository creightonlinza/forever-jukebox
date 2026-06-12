import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { AppBridge } from "../bridge";
import { TOP_SONGS_REFRESH_MS } from "../constants";
import { useAppStore } from "../store";
import { tabFromPathname } from "../tabs";
import { FaqPanel } from "./FaqPanel";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { SearchPanel } from "./SearchPanel";
import { Toast } from "./Toast";
import { TopTracksPanel } from "./TopTracksPanel";
import { InfoModal } from "./listen/InfoModal";
import { ListenPanel } from "./listen/ListenPanel";
import { PlaylistModal } from "./listen/PlaylistModal";
import { SleepTimerModal } from "./listen/SleepTimerModal";
import { TuningModal } from "./listen/TuningModal";

// Derives activeTab from the URL on every location change and runs the
// legacy route handler (mode-from-URL, track loading, FAQ subtab sync) on
// initial load and browser back/forward. The location.key guard keeps
// StrictMode's double-invoked effects from loading a track twice.
function useRouteSync(bridge: AppBridge) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    useAppStore.getState().setActiveTab(tabFromPathname(location.pathname));
    if (navigationType === "POP" && handledKeyRef.current !== location.key) {
      handledKeyRef.current = location.key;
      bridge.handleRoute(location.pathname);
    }
  }, [location, navigationType, bridge]);
}

// Side effects formerly in tabs.ts setActiveTab, keyed on the derived
// activeTab. Panels stay in the DOM permanently (each derives its own
// hidden class from activeTabId).
function useTabEffects(bridge: AppBridge) {
  const activeTab = useAppStore((s) => s.activeTabId);
  useEffect(() => {
    const { jukebox, engine } = bridge.context;
    useAppStore
      .getState()
      .setPlayTabPulsing(useAppStore.getState().isRunning && activeTab !== "play");
    if (activeTab === "play") {
      jukebox.resizeActive();
    } else if (activeTab === "top") {
      const { topSongsRefreshTimer } = useAppStore.getState();
      if (topSongsRefreshTimer !== null) {
        window.clearTimeout(topSongsRefreshTimer);
      }
      const nextTimer = window.setTimeout(() => {
        useAppStore.setState({ topSongsRefreshTimer: null });
      }, TOP_SONGS_REFRESH_MS);
      useAppStore.setState({ topSongsRefreshTimer: nextTimer });
    } else if (useAppStore.getState().shiftBranching) {
      useAppStore.setState({ shiftBranching: false });
      engine.setForceBranch(false);
    }
    if (activeTab !== "play" && useAppStore.getState().selectedEdge) {
      useAppStore.setState({ selectedEdge: null });
      jukebox.setSelectedEdge(null);
    }
  }, [activeTab, bridge]);
}

// Body-level flag CSS uses to reveal playlist-add buttons (formerly part
// of wire/playlist's syncPlaylistUi).
function usePlaylistAddEnabled() {
  const lastTrackId = useAppStore((s) => s.lastTrackId);
  const lastJobId = useAppStore((s) => s.lastJobId);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const enabled =
    Boolean(lastTrackId ?? lastJobId) && audioLoaded && analysisLoaded;
  useEffect(() => {
    document.body.classList.toggle("playlist-add-enabled", enabled);
  }, [enabled]);
}

function useThemeEffect(bridge: AppBridge) {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    bridge.applyTheme(theme);
  }, [theme, bridge]);
}

// Window-level hotkeys (playback shortcuts, delete-confirm, playlist modal),
// formerly registered by wire/ui.ts. Handlers themselves stay legacy until
// their panels convert. Registration order is preserved.
function useGlobalHotkeys(bridge: AppBridge) {
  useEffect(() => {
    const { keydown, keyup } = bridge.hotkeys;
    keydown.forEach((handler) => window.addEventListener("keydown", handler));
    keyup.forEach((handler) => window.addEventListener("keyup", handler));
    return () => {
      keydown.forEach((handler) =>
        window.removeEventListener("keydown", handler),
      );
      keyup.forEach((handler) => window.removeEventListener("keyup", handler));
    };
  }, [bridge]);
}

export function AppRoot({ bridge }: { bridge: AppBridge }) {
  useRouteSync(bridge);
  useTabEffects(bridge);
  useThemeEffect(bridge);
  useGlobalHotkeys(bridge);
  usePlaylistAddEnabled();
  return (
    <>
      <Hero bridge={bridge} />
      <TopTracksPanel bridge={bridge} />
      <SearchPanel bridge={bridge} />
      <ListenPanel bridge={bridge} />
      <FaqPanel />
      <Footer />
      <Toast />
      <TuningModal bridge={bridge} />
      <SleepTimerModal bridge={bridge} />
      <InfoModal />
      <PlaylistModal bridge={bridge} />
    </>
  );
}
