import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { getAppContext, handleRoute } from "../runtime";
import { useAppStore } from "../store";
import { tabFromPathname } from "../tabs";
import { applyTheme } from "../theme";
import {
  handleKeydown as playbackHandleKeydown,
  handleKeyup as playbackHandleKeyup,
} from "../wire/playback";
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
// route handler (mode-from-URL, track loading, FAQ subtab sync) on
// initial load and browser back/forward. The location.key guard keeps
// StrictMode's double-invoked effects from loading a track twice.
function useRouteSync() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    useAppStore.getState().setActiveTab(tabFromPathname(location.pathname));
    if (navigationType === "POP" && handledKeyRef.current !== location.key) {
      handledKeyRef.current = location.key;
      handleRoute(location.pathname);
    }
  }, [location, navigationType]);
}

// Side effects keyed on the derived activeTab. Panels stay in the DOM
// permanently (each derives its own hidden class from activeTabId).
function useTabEffects() {
  const activeTab = useAppStore((s) => s.activeTabId);
  useEffect(() => {
    const { jukebox, engine } = getAppContext();
    useAppStore
      .getState()
      .setPlayTabPulsing(useAppStore.getState().isRunning && activeTab !== "play");
    if (activeTab === "play") {
      jukebox.resizeActive();
    } else if (useAppStore.getState().shiftBranching) {
      useAppStore.setState({ shiftBranching: false });
      engine.setForceBranch(false);
    }
    if (activeTab !== "play" && useAppStore.getState().selectedEdge) {
      useAppStore.setState({ selectedEdge: null });
      jukebox.setSelectedEdge(null);
    }
  }, [activeTab]);
}

// Body-level flag CSS uses to reveal playlist-add buttons.
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

function useThemeEffect() {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    applyTheme(getAppContext(), theme);
  }, [theme]);
}

// Window-level hotkeys (playback shortcuts, delete-confirm, playlist modal).
function useGlobalHotkeys() {
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => playbackHandleKeydown(event);
    const onKeyup = (event: KeyboardEvent) => playbackHandleKeyup(event);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("keyup", onKeyup);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("keyup", onKeyup);
    };
  }, []);
}

export function AppRoot() {
  useRouteSync();
  useTabEffects();
  useThemeEffect();
  useGlobalHotkeys();
  usePlaylistAddEnabled();
  return (
    <>
      <Hero />
      <TopTracksPanel />
      <SearchPanel />
      <ListenPanel />
      <FaqPanel />
      <Footer />
      <Toast />
      <TuningModal />
      <SleepTimerModal />
      <InfoModal />
      <PlaylistModal />
    </>
  );
}
