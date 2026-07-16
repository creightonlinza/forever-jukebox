import { JukeboxEngine } from "@forever-jukebox/shared";
import { BufferedAudioPlayer } from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import { CowbellOverlayService } from "@forever-jukebox/shared/audio/CowbellOverlayService";
import { AutocanonizerController } from "@forever-jukebox/shared/autocanonizer/AutocanonizerController";
import { JukeboxController } from "@forever-jukebox/shared/viz/JukeboxController";
import { applyThemeVariables, resolveStoredTheme } from "./theme";
import { resolveStoredAnchorHighlight } from "./anchorHighlight";
import { resolveStoredBranchStatsEnabled } from "./extrasMode";
import {
  setAnalysisStatus,
  setLoadingProgress,
  showToast,
} from "./ui";
import { handleRouteChange } from "./routing";
import { initBackgroundTimer } from "@forever-jukebox/shared/background";
import { fetchAppConfig } from "./api";
import { loadAppConfig, saveAppConfig } from "./cache";
import {
  applyAnalysisResult,
  loadAudioFromJob,
  pollAnalysis,
  resetForNewTrack,
  updateVizVisibility,
} from "./playback";
import { setSearchRuntime, type SearchDeps } from "./search";
import { setUploadRuntime, type UploadDeps } from "./upload";
import { DEFAULT_VISUALIZATION_INDEX } from "./constants";
import {
  setAppRuntime,
  setAttachViz,
  setAdvancePlaylistOnAutocanonizerEnded,
  setPlaybackDeps,
  setRouteHandler,
  type AttachVizNodes,
} from "./runtime";
import type { AppContext, TabId } from "./context";
import type { AppConfig } from "./api";
import {
  maybeAutoFavoriteUserSupplied,
} from "./favorites-actions";
import {
  handleFullscreenChange,
  handleVisibilityChange,
  updateFullscreenButton,
} from "./fullscreen";
import {
  applyModeFromUrl,
  handleBeatSelect,
  handleEdgeSelect,
  initializePlayback,
} from "./playback-ui";
import {
  advanceAutocanonizerOnEnded,
  handleNormalTrackSelected,
} from "./playlist-actions";
import { applyAppConfig } from "./app-config";
import { useAppStore, type LocalizedText } from "./store";
import {
  loadFavorites,
  loadFavoritesSyncCode,
} from "./favorites";
import { loadPlaylist } from "./playlist";
import i18n from "./i18n";

type PlaybackDeps = Parameters<typeof pollAnalysis>[1];

export function initRuntime(): void {
  initBackgroundTimer();
  // Theme must apply before first paint; the React theme effect re-applies
  // idempotently (and persists + refreshes the viz) once mounted.
  const initialTheme = resolveStoredTheme();
  applyThemeVariables(initialTheme);
  document.body.classList.toggle("theme-light", initialTheme === "light");
  const player = new BufferedAudioPlayer();
  const cowbellOverlay = new CowbellOverlayService(player.getContext(), {
    getPlaybackRate: () => player.getPlaybackRate(),
    destination: player.getOverlayDestination(),
  });
  cowbellOverlay.setVolume(player.getVolume());
  const engine = new JukeboxEngine(player, { randomMode: "random" });
  const highlightAnchorBranch = resolveStoredAnchorHighlight();
  const branchStatsEnabled = resolveStoredBranchStatsEnabled();
  const defaultConfig = engine.getConfig();
  // The store holds all app state (defaults live in store.ts); hydrate the
  // persisted bits here, pre-render.
  useAppStore.setState({
    theme: initialTheme,
    favorites: loadFavorites(),
    playlist: loadPlaylist(),
    favoritesSyncCode: loadFavoritesSyncCode(),
    branchStatsEnabled,
    highlightAnchorBranch,
  });
  // Controllers need their DOM nodes, which exist only after <VizContainer>
  // renders; attachViz (below) constructs them and fills these slots before
  // any effect (route handling, theme) can touch them — main.ts mounts the
  // tree synchronously via flushSync.
  const context: AppContext = {
    engine,
    player,
    autocanonizer: null,
    jukebox: null,
    cowbellOverlay,
    defaultConfig,
  };
  // Expose the runtime singletons via the module-singleton keystone so flows
  // and components can reach them without the bridge prop. attachViz (below)
  // mutates this same `context`, so the viz controllers become visible through
  // getAppContext() once they're attached.
  setAppRuntime(context);
  // Navigation lives in the store now; the flows still take it as a dep (so
  // they stay unit-testable), resolved at call time via these thin wrappers.
  const navigateToTabWithState = (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => useAppStore.getState().navigateToTabWithState(tabId, options);
  const setActiveTabWithRefresh = (tabId: TabId) =>
    useAppStore.getState().setActiveTab(tabId);
  // Navigation + status closures shared by the playback and search flows.
  const sharedFlowDeps = {
    setActiveTab: setActiveTabWithRefresh,
    navigateToTab: navigateToTabWithState,
    updateTrackUrl: (trackId: string, replace?: boolean) =>
      useAppStore.getState().navigateToTrackWithState(trackId, {
        replace,
        tuningParams: useAppStore.getState().tuningParams,
        playMode: useAppStore.getState().playMode,
      }),
    setAnalysisStatus: (message: LocalizedText, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    setLoadingProgress: (
      progress: number | null,
      message?: LocalizedText | null,
    ) => setLoadingProgress(context, progress, message),
  };
  const playbackDeps: PlaybackDeps = { ...sharedFlowDeps };
  setPlaybackDeps(playbackDeps);
  setAdvancePlaylistOnAutocanonizerEnded(advanceAutocanonizerOnEnded);
  playbackDeps.onAnalysisLoaded = (response) => {
    maybeAutoFavoriteUserSupplied(response);
  };
  const searchDeps: SearchDeps = {
    ...sharedFlowDeps,
    showToast: (message, options) => showToast(message, options),
    pollAnalysis: (jobId: string) => pollAnalysis(context, playbackDeps, jobId),
    applyAnalysisResult: (response) =>
      applyAnalysisResult(
        context,
        response,
        (analysis) => {
          maybeAutoFavoriteUserSupplied(analysis);
        },
      ),
    loadAudioFromJob: (jobId: string) => loadAudioFromJob(context, jobId),
    resetForNewTrack: (options) => resetForNewTrack(context, options),
    updateVizVisibility: () => updateVizVisibility(),

    onNormalTrackSelected: handleNormalTrackSelected,
  };
  const uploadDeps: UploadDeps = {
    context,
    pollAnalysisJob: (jobId: string) =>
      pollAnalysis(context, playbackDeps, jobId),
    onNormalTrackSelected: handleNormalTrackSelected,
  };
  // Construct the viz controllers once <VizContainer> hands over its nodes
  // (ref phase — before any React effect runs). StrictMode re-attaches the
  // same nodes; the guard makes that a no-op.
  let vizAttached = false;
  const attachViz = (nodes: AttachVizNodes) => {
    if (vizAttached) {
      return;
    }
    vizAttached = true;
    const autocanonizer = new AutocanonizerController(nodes.canonizerLayer);
    const jukebox = new JukeboxController(nodes.vizLayer);
    context.autocanonizer = autocanonizer;
    context.jukebox = jukebox;
    const { autocanonizerMainPan, autocanonizerOtherPan } =
      useAppStore.getState();
    autocanonizer.setStreamPans(
      autocanonizerMainPan / 100,
      autocanonizerOtherPan / 100,
    );
    jukebox.setAnchorHighlightEnabled(useAppStore.getState().highlightAnchorBranch);
    jukebox.setActiveIndex(DEFAULT_VISUALIZATION_INDEX);
    initializePlayback();
    resetForNewTrack(context);
    document.addEventListener(
      "fullscreenchange",
      handleFullscreenChange,
    );
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    updateFullscreenButton(Boolean(document.fullscreenElement));
    jukebox.setOnSelect(handleBeatSelect);
    jukebox.setOnEdgeSelect(handleEdgeSelect);
  };
  setAttachViz(attachViz);

  setAnalysisStatus(context, () => i18n.t("status.noTrack"), false);
  loadAppConfig()
    .then((config) => {
      if (config) {
        applyAppConfig(config as AppConfig, {
          hydrateFavorites: false,
        });
      }
    })
    .catch((err) => {
      console.warn(`App config load failed: ${String(err)}`);
    });
  fetchAppConfig()
    .then((config) => {
      applyAppConfig(config);
      return saveAppConfig(config);
    })
    .catch((err) => {
      console.warn(`App config fetch failed: ${String(err)}`);
    });

  // Runs on initial load and browser back/forward, driven by the React
  // shell's route-sync effect (replaces the popstate listener and the
  // init-time handleRouteChange call).
  setRouteHandler((pathname) => {
    applyModeFromUrl();
    handleRouteChange(context, playbackDeps, pathname).catch((err) => {
      console.warn(`Route load failed: ${String(err)}`);
    });
  });

  setSearchRuntime(context, searchDeps);
  setUploadRuntime(uploadDeps);
}
