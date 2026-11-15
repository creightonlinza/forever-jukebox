import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigationType } from "react-router-dom";
import { trackPageView } from "../analytics";
import { getAppContext, handleRoute } from "../runtime";
import { useAppStore, type AppStoreState } from "../store";
import { tabFromPathname } from "../tabs";
import { applyTheme } from "../theme";
import { titleForAppView } from "../document-title";
import {
  handleKeydown as playbackHandleKeydown,
  handleKeyup as playbackHandleKeyup,
  handleWindowBlur as playbackHandleWindowBlur,
} from "../playback-ui";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { NavigationDriver } from "./NavigationDriver";
import { Toast } from "./Toast";
import { TopTracksPanel } from "./TopTracksPanel";
import { PlayMenu } from "./listen/PlayMenu";
import { StatusPanel } from "./listen/StatusPanel";
import { VizContainer } from "./listen/VizContainer";

const FaqPanel = lazy(() =>
  import("./FaqPanel").then((m) => ({ default: m.FaqPanel })),
);
const SearchPanel = lazy(() =>
  import("./SearchPanel").then((m) => ({ default: m.SearchPanel })),
);
const TuningModal = lazy(() =>
  import("./listen/TuningModal").then((m) => ({ default: m.TuningModal })),
);
const SettingsModal = lazy(() =>
  import("./SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
const FeedbackModal = lazy(() =>
  import("./FeedbackModal").then((m) => ({ default: m.FeedbackModal })),
);
const InfoModal = lazy(() =>
  import("./listen/InfoModal").then((m) => ({ default: m.InfoModal })),
);
const PlaylistModal = lazy(() =>
  import("./listen/PlaylistModal").then((m) => ({ default: m.PlaylistModal })),
);

// Mounts a lazy modal on its first open and keeps it mounted after close.
function LazyModal({
  isOpen,
  children,
}: {
  isOpen: (state: AppStoreState) => boolean;
  children: ReactNode;
}) {
  const open = useAppStore(isOpen);
  const [opened, setOpened] = useState(open);
  if (open && !opened) {
    setOpened(true);
  }
  return opened || open ? (
    <Suspense fallback={null}>{children}</Suspense>
  ) : null;
}

// Derives activeTab from the URL on every location change and runs the
// route handler (mode-from-URL, track loading, FAQ subtab sync) on
// initial load and browser back/forward. The location.key guard keeps
// StrictMode's double-invoked effects from loading a track twice.
function useRouteSync() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    trackPageView(location.pathname);
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
      {activeTab === "search" ? (
        <Suspense fallback={null}>
          <SearchPanel />
        </Suspense>
      ) : null}
      {/* The Listen panel. It persists in the DOM permanently — visibility is
          class-only, driven by the shell. */}
      <section
        className={activeTab === "play" ? "panel tab-panel" : "panel tab-panel hidden"}
        data-tab-panel="play"
      >
        <StatusPanel />
        <PlayMenu />
        <VizContainer />
      </section>
      {activeTab === "faq" ? (
        <Suspense fallback={null}>
          <FaqPanel />
        </Suspense>
      ) : null}
      <Footer />
      <Toast />
      <LazyModal isOpen={(s) => s.tuningModalOpen}>
        <TuningModal />
      </LazyModal>
      <LazyModal isOpen={(s) => s.settingsModalOpen}>
        <SettingsModal />
      </LazyModal>
      <LazyModal isOpen={(s) => s.feedbackModalOpen}>
        <FeedbackModal />
      </LazyModal>
      <LazyModal isOpen={(s) => s.infoModalOpen}>
        <InfoModal />
      </LazyModal>
      <LazyModal isOpen={(s) => s.playlistModalOpen}>
        <PlaylistModal />
      </LazyModal>
    </>
  );
}
