import { JukeboxEngine } from "../engine";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import { CowbellOverlayService } from "../audio/CowbellOverlayService";
import { getElements } from "./elements";
import { attachVisualizationResize } from "./visualization";
import { AutocanonizerController } from "../autocanonizer/AutocanonizerController";
import { JukeboxController } from "../jukebox/JukeboxController";
import { applyTheme, applyThemeVariables, resolveStoredTheme } from "./theme";
import { resolveStoredAnchorHighlight } from "./anchorHighlight";
import { resolveStoredBranchStatsEnabled } from "./extrasMode";
import {
  setAnalysisStatus,
  setLoadingProgress,
  isEditableTarget,
  showToast,
} from "./ui";
import { navigateToTab, updateTrackUrl } from "./tabs";
import { handleRouteChange } from "./routing";
import { initBackgroundTimer } from "../shared/backgroundTimer";
import {
  deleteJob,
  fetchAppConfig,
  fetchFavoritesSync,
  createFavoritesSync,
  startUrlAnalysis,
  updateFavoritesSync,
  uploadAudio,
} from "./api";
import { deleteCachedTrack, loadAppConfig, saveAppConfig } from "./cache";
import { isLikelyJobId } from "./identity";
import {
  applyAnalysisResult,
  applyTuningChanges,
  applyExtrasChanges,
  resetExtrasDefaults,
  closeInfo,
  closeTuning,
  resetTuningDefaults,
  loadAudioFromJob,
  loadTrackByJobId,
  loadTrackById,
  openExtras,
  openInfo,
  openTuning,
  pollAnalysis,
  releaseWakeLock,
  requestWakeLock,
  resetForNewTrack,
  addSleepTimerListener,
  syncDeletedEdgeState,
  startAutocanonizerPlayback,
  startJukeboxFromBeat,
  setSleepTimer,
  stopPlayback,
  syncExtrasUI,
  syncTuningTabsUI,
  setActiveTuningTab,
  getActiveTuningTab,
  togglePlayback,
  updateTrackInfo,
  updateVizVisibility,
} from "./playback";
import { runSearch, selectSpotifyMatch, selectYoutubeMatch } from "./search";
import { uploadAudioFile, uploadFromUrl, type UploadDeps } from "./upload";
import { DEFAULT_VISUALIZATION_INDEX } from "./constants";
import type { AppContext, AppState, TabId } from "./context";
import type { AppConfig } from "./api";
import { createFavoritesHandlers } from "./wire/favorites";
import { createNavigationHandlers } from "./wire/navigation";
import { createTuningHandlers } from "./wire/tuning";
import { createFullscreenHandlers } from "./wire/fullscreen";
import { createPlaybackUiHandlers } from "./wire/playback";
import { createPlaylistHandlers, type PlaylistHandlers } from "./wire/playlist";
import { createDeleteJobHandlers } from "./wire/delete-job";
import { createAppConfigHandlers } from "./wire/app-config";
import { bindUiHandlers } from "./wire/ui";
import type { AppBridge } from "./bridge";
import { legacyAppState, useAppStore } from "./store";
import {
  getTuningParamsFromEngine,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "./tuning";
import {
  addFavorite,
  isFavorite,
  loadFavorites,
  loadFavoritesSyncCode,
  maxFavorites,
  removeFavorite,
  saveFavoritesSyncCode,
  saveFavorites,
  sortFavorites,
} from "./favorites";
import { loadPlaylist, type PlaylistTrack } from "./playlist";

const vizStorageKey = "fj-viz";
const canonizerFinishKey = "fj-canonizer-finish";

type PlaybackDeps = Parameters<typeof pollAnalysis>[1];

type SearchDeps = Parameters<typeof runSearch>[1];

export function bootstrap(): AppBridge {
  initBackgroundTimer();
  const elements = getElements();
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
  const autocanonizer = new AutocanonizerController(elements.canonizerLayer);
  const jukebox = new JukeboxController(elements.vizLayer);
  const highlightAnchorBranch = resolveStoredAnchorHighlight();
  const branchStatsEnabled = resolveStoredBranchStatsEnabled();
  jukebox.setAnchorHighlightEnabled(highlightAnchorBranch);
  const defaultConfig = engine.getConfig();
  // The store holds all app state (defaults live in store.ts); hydrate the
  // persisted bits here, pre-render. `state` is the legacy proxy: every
  // `state.x = y` in playback.ts / wire/* is a store write.
  useAppStore.setState({
    theme: initialTheme,
    favorites: loadFavorites(),
    playlist: loadPlaylist(),
    favoritesSyncCode: loadFavoritesSyncCode(),
    branchStatsEnabled,
    highlightAnchorBranch,
  });
  const state: AppState = legacyAppState;
  const context: AppContext = {
    elements,
    engine,
    player,
    autocanonizer,
    jukebox,
    cowbellOverlay,
    defaultConfig,
    state,
  };
  let playlistHandlers: PlaylistHandlers | null = null;
  const syncPlaylistUi = () => playlistHandlers?.syncPlaylistUi();
  const handleNormalTrackSelected = (track: PlaylistTrack) => {
    playlistHandlers?.handleNormalTrackSelected(track);
  };

  const navigationHandlers = createNavigationHandlers({ context, state });
  const playbackHandlers = createPlaybackUiHandlers({
    context,
    elements,
    state,
    player,
    engine,
    jukebox,
    autocanonizer,
    vizStorageKey,
    canonizerFinishKey,
    setAnalysisStatus,
    showToast,
    stopPlayback,
    togglePlayback,
    startJukeboxFromBeat,
    startAutocanonizerPlayback,
    updateTrackUrl,
    navigateToTab,
    updateVizVisibility,
    openExtras,
    syncTuningTabsUI,
    getTuningParamsFromEngine,
    writeTuningParamsToUrl,
    syncDeletedEdgeState,
    updateTrackInfo,
    isEditableTarget,
    getCurrentTrackId: navigationHandlers.getCurrentTrackId,
    advancePlaylistOnAutocanonizerEnded: () =>
      playlistHandlers?.advanceAutocanonizerOnEnded() ?? Promise.resolve(false),
  });
  const playbackDeps: PlaybackDeps = {
    setActiveTab: (tabId: TabId) => navigationHandlers.setActiveTabWithRefresh(tabId),
    navigateToTab: (
      tabId: TabId,
      options?: { replace?: boolean; trackId?: string | null },
    ) => navigationHandlers.navigateToTabWithState(tabId, options),
    updateTrackUrl: (trackId: string, replace?: boolean) =>
      updateTrackUrl(trackId, replace, state.tuningParams, state.playMode),
    setAnalysisStatus: (message: string, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    setLoadingProgress: (progress: number | null, message?: string | null) =>
      setLoadingProgress(context, progress, message),
  };
  const favoritesHandlers = createFavoritesHandlers({
    context,
    elements,
    state,
    showToast,
    addFavorite,
    removeFavorite,
    isFavorite,
    sortFavorites,
    maxFavorites,
    saveFavorites,
    saveFavoritesSyncCode,
    fetchFavoritesSync,
    createFavoritesSync,
    updateFavoritesSync,
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
    writeTuningParamsToUrl,
    syncTuningParamsState,
    setPlayMode: playbackHandlers.setPlayMode,
  });
  playbackDeps.onTrackChange = () => {
    favoritesHandlers.syncFavoriteButton();
    syncPlaylistUi();
  };
  playbackDeps.onAnalysisLoaded = (response) => {
    favoritesHandlers.maybeAutoFavoriteUserSupplied(response);
    syncPlaylistUi();
  };
  playbackDeps.onPlaylistChange = syncPlaylistUi;
  const searchDeps: SearchDeps = {
    setActiveTab: (tabId: TabId) => navigationHandlers.setActiveTabWithRefresh(tabId),
    navigateToTab: (
      tabId: TabId,
      options?: { replace?: boolean; trackId?: string | null },
    ) => navigationHandlers.navigateToTabWithState(tabId, options),
    updateTrackUrl: (trackId: string, replace?: boolean) =>
      updateTrackUrl(trackId, replace, state.tuningParams, state.playMode),
    setAnalysisStatus: (message: string, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    showToast: (message, options) => showToast(context, message, options),
    setLoadingProgress: (progress: number | null, message?: string | null) =>
      setLoadingProgress(context, progress, message),
    pollAnalysis: (jobId: string) => pollAnalysis(context, playbackDeps, jobId),
    applyAnalysisResult: (response) =>
      applyAnalysisResult(
        context,
        response,
        (analysis) => {
          favoritesHandlers.maybeAutoFavoriteUserSupplied(analysis);
          syncPlaylistUi();
        },
      ),
    loadAudioFromJob: (jobId: string) => loadAudioFromJob(context, jobId),
    resetForNewTrack: (options) => resetForNewTrack(context, options),
    updateVizVisibility: () => updateVizVisibility(context),
    onTrackChange: () => {
      favoritesHandlers.syncFavoriteButton();
      syncPlaylistUi();
    },
    onNormalTrackSelected: handleNormalTrackSelected,
  };
  playlistHandlers = createPlaylistHandlers({
    context,
    elements,
    state,
    showToast,
    loadTrackById: (trackId, options) =>
      loadTrackById(context, playbackDeps, trackId, options),
    loadTrackByJobId: (jobId, options) =>
      loadTrackByJobId(context, playbackDeps, jobId, options),
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
    togglePlayback,
  });
  const appConfigHandlers = createAppConfigHandlers({
    state,
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
  const tuningHandlers = createTuningHandlers({
    context,
    elements,
    player,
    autocanonizer,
    openTuning,
    closeTuning,
    openInfo,
    closeInfo,
    applyTuningChanges,
    resetTuningDefaults,
    applyExtrasChanges,
    resetExtrasDefaults,
    syncExtrasUI,
    syncTuningTabsUI,
    setActiveTuningTab,
    getActiveTuningTab,
    setSleepTimer,
    addSleepTimerListener,
  });
  const fullscreenHandlers = createFullscreenHandlers({
    context,
    elements,
    jukebox,
    requestWakeLock,
    releaseWakeLock,
  });
  const deleteJobHandlers = createDeleteJobHandlers({
    context,
    elements,
    state,
    favoritesHandlers,
    deleteJob,
    deleteCachedTrack,
    resetForNewTrack,
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
    showToast,
    isFavorite,
    removeFavorite,
  });
  jukebox.setActiveIndex(DEFAULT_VISUALIZATION_INDEX);
  elements.vizSelect.disabled = true;
  attachVisualizationResize([jukebox], elements.vizPanel);
  attachVisualizationResize([autocanonizer], elements.vizPanel);
  playbackHandlers.initializePlayback();

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

  resetForNewTrack(context);
  favoritesHandlers.syncFavoriteButton();
  syncPlaylistUi();

  bindUiHandlers({
    elements,
    jukebox,
    favoritesHandlers,
    tuningHandlers,
    playbackHandlers,
    fullscreenHandlers,
    deleteJobHandlers,
    playlistHandlers: playlistHandlers!,
  });

  // Runs on initial load and browser back/forward, driven by the React
  // shell's route-sync effect (replaces the popstate listener and the
  // bootstrap-time handleRouteChange call).
  const handleRoute = (pathname: string) => {
    playbackHandlers.applyModeFromUrl();
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

  return {
    context,
    handleRoute,
    onTabClick,
    onHeroHomeClick: () => {
      navigationHandlers.navigateToTabWithState("top");
    },
    applyTheme: (theme) => {
      applyTheme(context, theme);
    },
    topPanel,
    searchPanel,
  };
}
