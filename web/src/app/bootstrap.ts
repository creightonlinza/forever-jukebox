import { JukeboxEngine } from "../engine";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import { getElements } from "./elements";
import { attachVisualizationResize } from "./visualization";
import { AutocanonizerController } from "../autocanonizer/AutocanonizerController";
import { JukeboxController } from "../jukebox/JukeboxController";
import { applyTheme, applyThemeVariables, resolveStoredTheme } from "./theme";
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
  fetchTopSongs,
  fetchRisingSongs,
  fetchRecentSongs,
  createFavoritesSync,
  updateFavoritesSync,
  startYoutubeAnalysis,
  uploadAudio,
} from "./api";
import { deleteCachedTrack, loadAppConfig, saveAppConfig } from "./cache";
import {
  applyAnalysisResult,
  applyTuningChanges,
  closeInfo,
  closeTuning,
  resetTuningDefaults,
  loadAudioFromJob,
  loadTrackByJobId,
  loadTrackByYouTubeId,
  openInfo,
  openTuning,
  pollAnalysis,
  releaseWakeLock,
  requestWakeLock,
  resetForNewTrack,
  syncDeletedEdgeState,
  startAutocanonizerPlayback,
  startJukeboxFromBeat,
  stopPlayback,
  togglePlayback,
  updateTrackInfo,
  updateVizVisibility,
} from "./playback";
import { runSearch } from "./search";
import { DEFAULT_VISUALIZATION_INDEX, TOP_SONGS_LIMIT } from "./constants";
import type { AppContext, AppState, TabId } from "./context";
import type { AppConfig } from "./api";
import { createFavoritesHandlers } from "./wire/favorites";
import { createNavigationHandlers } from "./wire/navigation";
import { createTabsHandlers } from "./wire/tabs";
import { createSearchHandlers } from "./wire/search";
import { createTuningHandlers } from "./wire/tuning";
import { createFullscreenHandlers } from "./wire/fullscreen";
import { createPlaybackUiHandlers } from "./wire/playback";
import { createDeleteJobHandlers } from "./wire/delete-job";
import { createTopSongsHandlers } from "./wire/top-songs";
import { createThemeHandlers } from "./wire/theme";
import { createAppConfigHandlers } from "./wire/app-config";
import { bindUiHandlers } from "./wire/ui";
import { createRoutingHandlers } from "./wire/routing";
import { createCacheHandlers } from "./wire/cache";
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

const vizStorageKey = "fj-viz";
const canonizerFinishKey = "fj-canonizer-finish";

type PlaybackDeps = Parameters<typeof pollAnalysis>[1];

type SearchDeps = Parameters<typeof runSearch>[1];

export function bootstrap() {
  initBackgroundTimer();
  const elements = getElements();
  const initialTheme = resolveStoredTheme();
  applyThemeVariables(initialTheme);
  document.body.classList.toggle("theme-light", initialTheme === "light");
  elements.themeLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.theme === initialTheme);
  });
  const player = new BufferedAudioPlayer();
  const engine = new JukeboxEngine(player, { randomMode: "random" });
  const autocanonizer = new AutocanonizerController(elements.canonizerLayer);
  const jukebox = new JukeboxController(elements.vizLayer);
  const defaultConfig = engine.getConfig();
  const state: AppState = {
    activeTabId: "top",
    activeVizIndex: DEFAULT_VISUALIZATION_INDEX,
    playMode: "jukebox",
    topSongsTab: "top",
    favorites: loadFavorites(),
    favoritesSyncCode: loadFavoritesSyncCode(),
    playTimerMs: 0,
    lastPlayStamp: null,
    lastBeatIndex: null,
    vizData: null,
    isRunning: false,
    audioLoaded: false,
    analysisLoaded: false,
    audioLoadInFlight: false,
    autoComputedThreshold: null,
    lastJobId: null,
    lastYouTubeId: null,
    pendingAutoFavoriteId: null,
    lastPlayCountedJobId: null,
    shiftBranching: false,
    selectedEdge: null,
    topSongsRefreshTimer: null,
    topSongsLoaded: false,
    risingSongsLoaded: false,
    recentSongsLoaded: false,
    trackDurationSec: null,
    trackTitle: null,
    trackArtist: null,
    toastTimer: null,
    deleteEligible: false,
    deleteEligibilityJobId: null,
    searchTab: "search",
    appConfig: null,
    pollController: null,
    listenTimerId: null,
    wakeLock: null,
    tuningParams: null,
    deletedEdgeIds: [],
  };
  const context: AppContext = {
    elements,
    engine,
    player,
    autocanonizer,
    jukebox,
    defaultConfig,
    state,
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
    getTuningParamsFromEngine,
    writeTuningParamsToUrl,
    syncDeletedEdgeState,
    updateTrackInfo,
    isEditableTarget,
    getCurrentTrackId: navigationHandlers.getCurrentTrackId,
  });
  const playbackDeps: PlaybackDeps = {
    setActiveTab: (tabId: TabId) => navigationHandlers.setActiveTabWithRefresh(tabId),
    navigateToTab: (
      tabId: TabId,
      options?: { replace?: boolean; youtubeId?: string | null },
    ) => navigationHandlers.navigateToTabWithState(tabId, options),
    updateTrackUrl: (youtubeId: string, replace?: boolean) =>
      updateTrackUrl(youtubeId, replace, state.tuningParams, state.playMode),
    setAnalysisStatus: (message: string, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    setLoadingProgress: (progress: number | null, message?: string | null) =>
      setLoadingProgress(context, progress, message),
    onTrackChange: () => favoritesHandlers.syncFavoriteButton(),
    onAnalysisLoaded: (response) =>
      favoritesHandlers.maybeAutoFavoriteUserSupplied(response),
  };
  const searchDeps: SearchDeps = {
    setActiveTab: (tabId: TabId) => navigationHandlers.setActiveTabWithRefresh(tabId),
    navigateToTab: (
      tabId: TabId,
      options?: { replace?: boolean; youtubeId?: string | null },
    ) => navigationHandlers.navigateToTabWithState(tabId, options),
    updateTrackUrl: (youtubeId: string, replace?: boolean) =>
      updateTrackUrl(youtubeId, replace, state.tuningParams, state.playMode),
    setAnalysisStatus: (message: string, spinning: boolean) =>
      setAnalysisStatus(context, message, spinning),
    setLoadingProgress: (progress: number | null, message?: string | null) =>
      setLoadingProgress(context, progress, message),
    pollAnalysis: (jobId: string) => pollAnalysis(context, playbackDeps, jobId),
    applyAnalysisResult: (response) =>
      applyAnalysisResult(
        context,
        response,
        favoritesHandlers.maybeAutoFavoriteUserSupplied,
      ),
    loadAudioFromJob: (jobId: string) => loadAudioFromJob(context, jobId),
    resetForNewTrack: (options) => resetForNewTrack(context, options),
    updateVizVisibility: () => updateVizVisibility(context),
    onTrackChange: () => favoritesHandlers.syncFavoriteButton(),
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
    loadTrackByYouTubeId: (youtubeId) =>
      loadTrackByYouTubeId(context, playbackDeps, youtubeId, {
        preserveUrlTuning: true,
      }),
    loadTrackByJobId: (jobId) =>
      loadTrackByJobId(context, playbackDeps, jobId, {
        preserveUrlTuning: true,
      }),
    writeTuningParamsToUrl,
    syncTuningParamsState,
    setPlayMode: playbackHandlers.setPlayMode,
  });
  const topSongsHandlers = createTopSongsHandlers({
    elements,
    fetchTopSongs,
    fetchRisingSongs,
    fetchRecentSongs,
    limit: TOP_SONGS_LIMIT,
    loadTrackByYouTubeId: (youtubeId: string) =>
      loadTrackByYouTubeId(context, playbackDeps, youtubeId),
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
  });
  const tabsHandlers = createTabsHandlers({
    elements,
    state,
    favoritesHandlers,
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
    onTopSongsTabChange: (tabId) => {
      if (tabId === "top") {
        if (state.topSongsLoaded) {
          return;
        }
        topSongsHandlers
          .fetchTopSongsList()
          .then(() => {
            state.topSongsLoaded = true;
          })
          .catch((err) => {
            console.warn(`Top songs load failed: ${String(err)}`);
          });
      }
      if (tabId === "rising") {
        if (state.risingSongsLoaded) {
          return;
        }
        topSongsHandlers
          .fetchRisingSongsList()
          .then(() => {
            state.risingSongsLoaded = true;
          })
          .catch((err) => {
            console.warn(`Rising songs load failed: ${String(err)}`);
          });
      }
      if (tabId === "recent") {
        if (state.recentSongsLoaded) {
          return;
        }
        topSongsHandlers
          .fetchRecentSongsList()
          .then(() => {
            state.recentSongsLoaded = true;
          })
          .catch((err) => {
            console.warn(`Recent songs load failed: ${String(err)}`);
          });
      }
    },
    onFaqOpen: () => {
      cacheHandlers.refreshCacheButton().catch((err) => {
        console.warn(`Cache size failed: ${String(err)}`);
      });
    },
  });
  const appConfigHandlers = createAppConfigHandlers({
    elements,
    state,
    favoritesHandlers,
    tabsHandlers,
  });
  const searchHandlers = createSearchHandlers({
    context,
    elements,
    state,
    searchDeps,
    runSearch,
    showToast,
    uploadAudio,
    startYoutubeAnalysis,
    resetForNewTrack,
    setActiveTabWithRefresh: navigationHandlers.setActiveTabWithRefresh,
    setLoadingProgress,
    updateTrackUrl,
    pollAnalysisJob: (jobId: string) =>
      pollAnalysis(context, playbackDeps, jobId),
  });
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
  const themeHandlers = createThemeHandlers({
    context,
    elements,
    applyTheme,
  });
  const routingHandlers = createRoutingHandlers({
    context,
    playbackHandlers,
    handleRouteChange,
    playbackDeps,
    onFaqOpen: () => {
      cacheHandlers.refreshCacheButton().catch((err) => {
        console.warn(`Cache size failed: ${String(err)}`);
      });
    },
  });
  const cacheHandlers = createCacheHandlers({
    context,
    elements,
    showToast,
  });

  jukebox.setActiveIndex(DEFAULT_VISUALIZATION_INDEX);
  elements.vizSelect.disabled = true;
  attachVisualizationResize([jukebox], elements.vizPanel);
  attachVisualizationResize([autocanonizer], elements.vizPanel);
  playbackHandlers.initializePlayback();

  navigationHandlers.setActiveTabWithRefresh("top");
  setAnalysisStatus(context, "No song selected.", false);
  applyTheme(context, initialTheme);
  loadAppConfig()
    .then((config) => {
      if (config) {
        appConfigHandlers.applyAppConfig(config as AppConfig);
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
  favoritesHandlers.renderFavoritesList();
  tabsHandlers.setTopSongsTab("top");
  favoritesHandlers.updateFavoritesSyncControls();
  cacheHandlers.refreshCacheButton().catch((err) => {
    console.warn(`Cache size failed: ${String(err)}`);
  });

  resetForNewTrack(context);
  favoritesHandlers.syncFavoriteButton();

  playbackHandlers.applyModeFromUrl();
  handleRouteChange(context, playbackDeps, window.location.pathname).catch(
    (err) => {
      console.warn(`Route load failed: ${String(err)}`);
    },
  );
  if (window.location.pathname.startsWith("/faq")) {
    cacheHandlers.refreshCacheButton().catch((err) => {
      console.warn(`Cache size failed: ${String(err)}`);
    });
  }

  window.addEventListener("popstate", routingHandlers.handlePopState);
  bindUiHandlers({
    elements,
    jukebox,
    favoritesHandlers,
    tabsHandlers,
    searchHandlers,
    tuningHandlers,
    playbackHandlers,
    fullscreenHandlers,
    deleteJobHandlers,
    themeHandlers,
    cacheHandlers,
  });

}
