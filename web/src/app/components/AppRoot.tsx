import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigationType } from "react-router-dom";
import { getAppContext, handleRoute } from "../runtime";
import { useAppStore } from "../store";
import { tabFromPathname } from "../tabs";
import { applyTheme } from "../theme";
import { titleForAppView } from "../document-title";
import {
  handleKeydown as playbackHandleKeydown,
  handleKeyup as playbackHandleKeyup,
  handleWindowBlur as playbackHandleWindowBlur,
} from "../playback-ui";
import { FaqPanel } from "./FaqPanel";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { NavigationDriver } from "./NavigationDriver";
import { SearchPanel } from "./SearchPanel";
import { SettingsModal } from "./SettingsModal";
import { Toast } from "./Toast";
import { TopTracksPanel } from "./TopTracksPanel";
import { InfoModal } from "./listen/InfoModal";
import { ListenPanel } from "./listen/ListenPanel";
import { PlaylistModal } from "./listen/PlaylistModal";
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

// Side effects keyed on the derived activeTab. Listen stays DOM-mounted;
// regular tab panels mount only while active.
function useTabEffects() {
  const activeTab = useAppStore((s) => s.activeTabId);
  useEffect(() => {
    const { jukebox, engine } = getAppContext();
    useAppStore
      .getState()
      .setPlayTabPulsing(useAppStore.getState().isRunning && activeTab !== "play");
    if (activeTab === "play") {
      jukebox?.resizeActive();
    } else if (useAppStore.getState().shiftBranching) {
      useAppStore.setState({ shiftBranching: false });
      engine.setForceBranch(false);
    }
    if (activeTab !== "play" && useAppStore.getState().selectedEdge) {
      useAppStore.setState({ selectedEdge: null });
      jukebox?.setSelectedEdge(null);
    }
  }, [activeTab]);
}

function useDocumentTitle() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const activeTab = useAppStore((s) => s.activeTabId);
  const trackTitle = useAppStore((s) => s.trackTitle);
  const trackArtist = useAppStore((s) => s.trackArtist);
  useEffect(() => {
    document.title = titleForAppView({
      activeTabId: activeTab,
      pathname: location.pathname,
      trackTitle,
      trackArtist,
    });
    // i18n.language is a dependency so the title re-localizes on language change.
  }, [activeTab, location.pathname, trackTitle, trackArtist, i18n.language]);
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
    const onBlur = () => playbackHandleWindowBlur();
    // Blur alone can be missed on tab switches (e.g. Ctrl+T), leaving
    // freeze/branch modes stuck; visibilitychange covers that path.
    const onVisibilityChange = () => {
      if (document.hidden) {
        playbackHandleWindowBlur();
      }
    };
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("keyup", onKeyup);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("keyup", onKeyup);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      playbackHandleWindowBlur();
    };
  }, []);
}

export function AppRoot() {
  const activeTab = useAppStore((s) => s.activeTabId);
  useRouteSync();
  useTabEffects();
  useThemeEffect();
  useGlobalHotkeys();
  usePlaylistAddEnabled();
  useDocumentTitle();
  return (
    <>
      <NavigationDriver />
      <Hero />
      {activeTab === "top" ? <TopTracksPanel /> : null}
      {activeTab === "search" ? <SearchPanel /> : null}
      <ListenPanel visible={activeTab === "play"} />
      {activeTab === "faq" ? <FaqPanel /> : null}
      <Footer />
      <Toast />
      <TuningModal />
      <SettingsModal />
      <InfoModal />
      <PlaylistModal />
    </>
  );
}
