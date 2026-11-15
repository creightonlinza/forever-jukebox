import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { trackPageView } from "../analytics";
import { getLocation, subscribeLocation } from "../history";
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
import { lazyImports } from "./lazyImports";

const FaqPanel = lazy(lazyImports.faq);
const SearchPanel = lazy(lazyImports.search);
const TuningModal = lazy(lazyImports.tuning);
const SettingsModal = lazy(lazyImports.settings);
const FeedbackModal = lazy(lazyImports.feedback);
const InfoModal = lazy(lazyImports.info);
const PlaylistModal = lazy(lazyImports.playlist);

// Suspense for one lazy component; a chunk that fails to load renders nothing
// and leaves the rest of the app running.
class LazyBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : (
      <Suspense fallback={null}>{this.props.children}</Suspense>
    );
  }
}

// Fetches every lazy chunk once the browser is idle after mount, so chunks
// from this build stay loadable after a later deploy removes them.
function useWarmLazyChunks() {
  useEffect(() => {
    const warm = () => {
      for (const load of Object.values(lazyImports)) {
        load().catch(() => {});
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(timer);
  }, []);
}

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
  return opened || open ? <LazyBoundary>{children}</LazyBoundary> : null;
}

// Derives activeTab from the URL on every location change and runs the
// route handler (mode-from-URL, track loading, FAQ subtab sync) on
// initial load and browser back/forward. The location.key guard keeps
// StrictMode's double-invoked effects from loading a track twice.
function useRouteSync() {
  const location = useSyncExternalStore(subscribeLocation, getLocation);
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    trackPageView(location.pathname);
    useAppStore.getState().setActiveTab(tabFromPathname(location.pathname));
    if (location.type === "POP" && handledKeyRef.current !== location.key) {
      handledKeyRef.current = location.key;
      handleRoute(location.pathname);
    }
  }, [location]);
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
  const location = useSyncExternalStore(subscribeLocation, getLocation);
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
  useWarmLazyChunks();
  return (
    <>
      <NavigationDriver />
      <Hero />
      {activeTab === "top" ? <TopTracksPanel /> : null}
      {activeTab === "search" ? (
        <LazyBoundary>
          <SearchPanel />
        </LazyBoundary>
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
        <LazyBoundary>
          <FaqPanel />
        </LazyBoundary>
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
