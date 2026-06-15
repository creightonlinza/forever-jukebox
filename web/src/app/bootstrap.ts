import { JukeboxEngine } from "@forever-jukebox/engine";
import { BufferedAudioPlayer } from "@forever-jukebox/engine/audio/BufferedAudioPlayer";
import { CowbellOverlayService } from "@forever-jukebox/engine/audio/CowbellOverlayService";
import { AutocanonizerController } from "@forever-jukebox/engine/autocanonizer/AutocanonizerController";
import { JukeboxController } from "@forever-jukebox/engine/viz/JukeboxController";
import { applyTheme, applyThemeVariables, resolveStoredTheme } from "./theme";
import { resolveStoredAnchorHighlight } from "./anchorHighlight";
import { resolveStoredBranchStatsEnabled } from "./extrasMode";
import {
  setAnalysisStatus,
  setLoadingProgress,
  showToast,
} from "./ui";
import { updateTrackUrl } from "./tabs";
import { handleRouteChange } from "./routing";
import { initBackgroundTimer } from "@forever-jukebox/engine/background";
import {
  fetchAppConfig,
  startUrlAnalysis,
  uploadAudio,
} from "./api";
import { loadAppConfig, saveAppConfig } from "./cache";
import { isLikelyJobId } from "./identity";
import {
  applyAnalysisResult,
  applyTuningChanges,
  applyExtrasChanges,
  resetExtrasDefaults,
  resetTuningDefaults,
  getExtrasFormValues,
  getTuningFormValues,
  loadAudioFromJob,
  loadTrackByJobId,
  loadTrackById,
  pollAnalysis,
  resetForNewTrack,
  setMasterVolume,
  setSleepTimer,
  togglePlayback,
  updateVizVisibility,
  type ExtrasFormValues,
  type TuningFormValues,
} from "./playback";
import { runSearch, selectSpotifyMatch, selectYoutubeMatch } from "./search";
import { uploadAudioFile, uploadFromUrl, type UploadDeps } from "./upload";
import { DEFAULT_VISUALIZATION_INDEX } from "./constants";
import type { AppContext, TabId } from "./context";
import type { AppConfig } from "./api";
import { createFavoritesHandlers } from "./wire/favorites";
import { createNavigationHandlers } from "./wire/navigation";
import { createFullscreenHandlers, type FullscreenHandlers } from "./wire/fullscreen";
import { createPlaybackUiHandlers, type PlaybackUiHandlers } from "./wire/playback";
import { createPlaylistHandlers, type PlaylistHandlers } from "./wire/playlist";
import { createDeleteJobHandlers } from "./wire/delete-job";
import { createAppConfigHandlers } from "./wire/app-config";
import type { AppBridge } from "./bridge";
import { useAppStore } from "./store";
import {
  loadFavorites,
  loadFavoritesSyncCode,
} from "./favorites";
import { loadPlaylist, type PlaylistTrack } from "./playlist";

const vizStorageKey = "fj-viz";
const canonizerFinishKey = "fj-canonizer-finish";

type PlaybackDeps = Parameters<typeof pollAnalysis>[1];

type SearchDeps = Parameters<typeof runSearch>[1];

export function bootstrap(): AppBridge {
  initBackgroundTimer();
  // Theme must apply before first paint; the React theme effect re-applies
  // idempotently (and persists + refreshes the viz) once mounted.
  const initialTheme = resolveStoredTheme();
  applyThemeVariables(initialTheme);
  document.body.classList.toggle("theme-light", initialTheme === "light");
  const player = new BufferedAudioPlayer();
  const cowbellOverlay = new CowbellOverlayService(player.getContext(), {
    getPlaybackRate: () => player.getPlaybackRate(),
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
    autocanonizer: null as unknown as AppContext["autocanonizer"],
    jukebox: null as unknown as AppContext["jukebox"],
    cowbellOverlay,
    defaultConfig,
  };
  let playlistHandlers: PlaylistHandlers | null = null;
  const handleNormalTrackSelected = (track: PlaylistTrack) => {
    playlistHandlers?.handleNormalTrackSelected(track);
  };

  const navigationHandlers = createNavigationHandlers();
  let playbackHandlers: PlaybackUiHandlers | null = null;
  let fullscreenHandlers: FullscreenHandlers | null = null;
  const playbackDeps: PlaybackDeps = {
    setActiveTab: (tabId: TabId) => navigationHandlers.setActiveTabWithRefresh(tabId),
    navigateToTab: (
      tabId: TabId,
      options?: { replace?: boolean; trackId?: string | null },
    ) => navigationHandlers.navigateToTabWithState(tabId, options),
    updateTrackUrl: (trackId: string, replace?: boolean) =>
      updateTrackUrl(trackId, replace, useAppStore.getState().tuningParams, useAppStore.getState().playMode),
    setAnalysisStatus: (message: string, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    setLoadingProgress: (progress: number | null, message?: string | null) =>
      setLoadingProgress(context, progress, message),
  };
  const favoritesHandlers = createFavoritesHandlers({
    context,
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
    loadTrackById: (trackId, options) =>
      loadTrackById(context, playbackDeps, trackId, {
        preserveUrlTuning: true,
        ...options,
      }),
    loadTrackByJobId: (jobId, options) =>
      loadTrackByJobId(context, playbackDeps, jobId, {
        preserveUrlTuning: true,
        ...options,
      }),
    setPlayMode: (mode) => playbackHandlers?.setPlayMode(mode),
  });
  playbackDeps.onAnalysisLoaded = (response) => {
    favoritesHandlers.maybeAutoFavoriteUserSupplied(response);
  };
  const searchDeps: SearchDeps = {
    setActiveTab: (tabId: TabId) => navigationHandlers.setActiveTabWithRefresh(tabId),
    navigateToTab: (
      tabId: TabId,
      options?: { replace?: boolean; trackId?: string | null },
    ) => navigationHandlers.navigateToTabWithState(tabId, options),
    updateTrackUrl: (trackId: string, replace?: boolean) =>
      updateTrackUrl(trackId, replace, useAppStore.getState().tuningParams, useAppStore.getState().playMode),
    setAnalysisStatus: (message: string, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    showToast: (message, options) => showToast(message, options),
    setLoadingProgress: (progress: number | null, message?: string | null) =>
      setLoadingProgress(context, progress, message),
    pollAnalysis: (jobId: string) => pollAnalysis(context, playbackDeps, jobId),
    applyAnalysisResult: (response) =>
      applyAnalysisResult(
        context,
        response,
        (analysis) => {
          favoritesHandlers.maybeAutoFavoriteUserSupplied(analysis);
        },
      ),
    loadAudioFromJob: (jobId: string) => loadAudioFromJob(context, jobId),
    resetForNewTrack: (options) => resetForNewTrack(context, options),
    updateVizVisibility: () => updateVizVisibility(),

    onNormalTrackSelected: handleNormalTrackSelected,
  };
  playlistHandlers = createPlaylistHandlers({
    context,
    loadTrackById: (trackId, options) =>
      loadTrackById(context, playbackDeps, trackId, options),
    loadTrackByJobId: (jobId, options) =>
      loadTrackByJobId(context, playbackDeps, jobId, options),
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
    setPlayMode: (mode) => playbackHandlers?.setPlayMode(mode),
  });
  const appConfigHandlers = createAppConfigHandlers({
    favoritesHandlers,
  });
  const uploadDeps: UploadDeps = {
    context,
    showToast,
    uploadAudio,
    startUrlAnalysis,
    resetForNewTrack,
    setActiveTabWithRefresh: navigationHandlers.setActiveTabWithRefresh,
    setLoadingProgress,
    updateTrackUrl,
    pollAnalysisJob: (jobId: string) =>
      pollAnalysis(context, playbackDeps, jobId),
    onNormalTrackSelected: handleNormalTrackSelected,
  };
  const deleteJobHandlers = createDeleteJobHandlers({
    context,
    favoritesHandlers,
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
  });
  // Construct the viz controllers once <VizContainer> hands over its nodes
  // (ref phase — before any React effect runs). StrictMode re-attaches the
  // same nodes; the guard makes that a no-op.
  let vizAttached = false;
  const attachViz: AppBridge["attachViz"] = (nodes) => {
    if (vizAttached) {
      return;
    }
    vizAttached = true;
    const autocanonizer = new AutocanonizerController(nodes.canonizerLayer);
    const jukebox = new JukeboxController(nodes.vizLayer);
    context.autocanonizer = autocanonizer;
    context.jukebox = jukebox;
    jukebox.setAnchorHighlightEnabled(useAppStore.getState().highlightAnchorBranch);
    playbackHandlers = createPlaybackUiHandlers({
      context,
      player,
      engine,
      jukebox,
      autocanonizer,
      vizStorageKey,
      canonizerFinishKey,
      getCurrentTrackId: navigationHandlers.getCurrentTrackId,
      advancePlaylistOnAutocanonizerEnded: () =>
        playlistHandlers?.advanceAutocanonizerOnEnded() ?? Promise.resolve(false),
    });
    fullscreenHandlers = createFullscreenHandlers({
      jukebox,
      getVizPanel: () => nodes.vizPanel,
    });
    jukebox.setActiveIndex(DEFAULT_VISUALIZATION_INDEX);
    playbackHandlers.initializePlayback();
    resetForNewTrack(context);
    document.addEventListener(
      "fullscreenchange",
      fullscreenHandlers.handleFullscreenChange,
    );
    document.addEventListener(
      "visibilitychange",
      fullscreenHandlers.handleVisibilityChange,
    );
    fullscreenHandlers.updateFullscreenButton(
      Boolean(document.fullscreenElement),
    );
    jukebox.setOnSelect(playbackHandlers.handleBeatSelect);
    jukebox.setOnEdgeSelect(playbackHandlers.handleEdgeSelect);
  };

  setAnalysisStatus(context, "No track selected.", false);
  loadAppConfig()
    .then((config) => {
      if (config) {
        appConfigHandlers.applyAppConfig(config as AppConfig, {
          hydrateFavorites: false,
        });
      }
    })
    .catch((err) => {
      console.warn(`App config load failed: ${String(err)}`);
    });
  fetchAppConfig()
    .then((config) => {
      appConfigHandlers.applyAppConfig(config);
      return saveAppConfig(config);
    })
    .catch((err) => {
      console.warn(`App config fetch failed: ${String(err)}`);
    });

  // Runs on initial load and browser back/forward, driven by the React
  // shell's route-sync effect (replaces the popstate listener and the
  // bootstrap-time handleRouteChange call).
  const handleRoute = (pathname: string) => {
    playbackHandlers?.applyModeFromUrl();
    handleRouteChange(context, playbackDeps, pathname).catch((err) => {
      console.warn(`Route load failed: ${String(err)}`);
    });
  };

  const onTabClick = (tabId: TabId) => {
    if (tabId === "top") {
      useAppStore.setState({ topSongsTab: "top" });
    }
    if (tabId === "search") {
      useAppStore.setState({ searchTab: "search" });
    }
    navigationHandlers.navigateToTabWithState(tabId);
  };

  const topPanel = {
    selectTrack: (trackId: string, selectedTrack: PlaylistTrack | null) => {
      navigationHandlers.navigateToTabWithState("play", { trackId });
      if (isLikelyJobId(trackId)) {
        void loadTrackByJobId(context, playbackDeps, trackId, { selectedTrack });
        return;
      }
      void loadTrackById(context, playbackDeps, trackId, { selectedTrack });
    },
    selectFavorite: favoritesHandlers.handleFavoriteSelect,
    addToPlaylist: (track: PlaylistTrack) => {
      playlistHandlers?.handleAddToPlaylist(track);
    },
    removeFavorite: favoritesHandlers.removeFavoriteWithToast,
    refreshFavoritesFromSync: favoritesHandlers.refreshFavoritesFromSync,
    enterSyncCode: favoritesHandlers.enterSyncCode,
    createSyncCode: favoritesHandlers.createSyncCode,
  };

  const searchPanel = {
    runSearch: () => runSearch(context, searchDeps),
    selectSpotify: (selection: { name: string; artist: string; duration: number }) =>
      selectSpotifyMatch(context, searchDeps, selection),
    selectYoutube: (selection: {
      youtubeId: string | null | undefined;
      name: string;
      artist: string;
      duration: number;
    }) => selectYoutubeMatch(context, searchDeps, selection),
    uploadFile: (file: File | null | undefined, onAccepted?: () => void) =>
      uploadAudioFile(uploadDeps, file, onAccepted),
    uploadUrl: (raw: string, onAccepted?: () => void) =>
      uploadFromUrl(uploadDeps, raw, onAccepted),
  };

  const listenPanel = {
    copyShortUrl: () => playbackHandlers?.handleShortUrlClick(),
    toggleFavorite: () => {
      void favoritesHandlers.handleFavoriteToggle();
    },
    getPendingDelete: deleteJobHandlers.getPendingDelete,
    performDelete: deleteJobHandlers.performDelete,
    getTuningForm: () => getTuningFormValues(context),
    applyTuning: (form: TuningFormValues) => applyTuningChanges(context, form),
    resetTuning: () => {
      resetTuningDefaults(context);
    },
    getExtrasForm: () => getExtrasFormValues(),
    applyExtras: (values: ExtrasFormValues) =>
      applyExtrasChanges(context, values),
    resetExtras: () => resetExtrasDefaults(context),
    setSleepTimer: (durationMs: number | null) =>
      setSleepTimer(context, durationMs),
    togglePlayback: () => togglePlayback(context),
    setPlayMode: (mode: "jukebox" | "autocanonizer") =>
      playbackHandlers?.setPlayMode(mode),
    setActiveVisualization: (index: number) =>
      playbackHandlers?.setActiveVisualization(index),
    setCanonizerFinish: (checked: boolean) =>
      playbackHandlers?.setCanonizerFinish(checked),
    deleteSelectedBranch: () => playbackHandlers?.deleteSelectedBranch(),
    playlistPrevious: () => playlistHandlers!.handlePlaylistPrevious(),
    playlistNext: () => playlistHandlers!.handlePlaylistNext(),
    setVolume: (volumePct: number) => setMasterVolume(context, volumePct),
    toggleFullscreen: () => fullscreenHandlers?.handleFullscreenToggle(),
    playlist: {
      selectIndex: (index: number) =>
        playlistHandlers!.selectPlaylistIndex(index),
      removeIndex: (index: number) =>
        playlistHandlers!.removePlaylistIndex(index),
      clear: () => playlistHandlers!.handleClearPlaylist(),
    },
  };

  return {
    context,
    handleRoute,
    onTabClick,
    hotkeys: {
      keydown: [(event) => playbackHandlers?.handleKeydown(event)],
      keyup: [(event) => playbackHandlers?.handleKeyup(event)],
    },
    onHeroHomeClick: () => {
      navigationHandlers.navigateToTabWithState("top");
    },
    applyTheme: (theme) => {
      applyTheme(context, theme);
    },
    topPanel,
    searchPanel,
    listenPanel,
    attachViz,
  };
}

