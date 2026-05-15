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
import { navigateToTab, type FaqSubtabId, updateTrackUrl } from "./tabs";
import { handleRouteChange } from "./routing";
import { initBackgroundTimer } from "../shared/backgroundTimer";
import {
  deleteJob,
  fetchAppConfig,
  fetchFavoritesSync,
  fetchTopSongs,
  fetchTrendingSongs,
  fetchRecentSongs,
  createFavoritesSync,
  startUrlAnalysis,
  updateFavoritesSync,
  uploadAudio,
} from "./api";
import { deleteCachedTrack, loadAppConfig, saveAppConfig } from "./cache";
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
  syncDeletedEdgeState,
  startAutocanonizerPlayback,
  startJukeboxFromBeat,
  stopPlayback,
  syncExtrasUI,
  syncTuningTabsUI,
  setActiveTuningTab,
  getActiveTuningTab,
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
    isPaused: false,
    audioLoaded: false,
    analysisLoaded: false,
    audioLoadInFlight: false,
    autoComputedThreshold: null,
    lastJobId: null,
    lastTrackId: null,
    lastSourceProvider: null,
    pendingAutoFavoriteId: null,
    lastPlayCountedJobId: null,
    shiftBranching: false,
    bringItHomeMode: false,
    branchStatsEnabled,
    jukeboxAudioMode: "off",
    swingPreparing: false,
    swingRenderToken: 0,
    selectedEdge: null,
    topSongsRefreshTimer: null,
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
    highlightAnchorBranch,
  };
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
  const cacheHandlers = createCacheHandlers({
    context,
    elements,
    showToast,
  });
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
    loadTrackById: (trackId) =>
      loadTrackById(context, playbackDeps, trackId, {
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
  playbackDeps.onTrackChange = () => favoritesHandlers.syncFavoriteButton();
  playbackDeps.onAnalysisLoaded = (response) =>
    favoritesHandlers.maybeAutoFavoriteUserSupplied(response);
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
        favoritesHandlers.maybeAutoFavoriteUserSupplied,
      ),
    loadAudioFromJob: (jobId: string) => loadAudioFromJob(context, jobId),
    resetForNewTrack: (options) => resetForNewTrack(context, options),
    updateVizVisibility: () => updateVizVisibility(context),
    onTrackChange: () => favoritesHandlers.syncFavoriteButton(),
  };
  const topSongsHandlers = createTopSongsHandlers({
    elements,
    fetchTopSongs,
    fetchTrendingSongs,
    fetchRecentSongs,
    limit: TOP_SONGS_LIMIT,
    loadTrackById: (trackId: string) =>
      loadTrackById(context, playbackDeps, trackId),
    loadTrackByJobId: (jobId: string) =>
      loadTrackByJobId(context, playbackDeps, jobId),
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
  });
  type LazyTopSongsTab = "top" | "trending" | "recent";
  const loadedTopSongTabs = new Set<LazyTopSongsTab>();
  const topSongsTabLoaders = {
    top: {
      fetch: () => topSongsHandlers.fetchTopSongsList(),
      errorLabel: "Top songs",
    },
    trending: {
      fetch: () => topSongsHandlers.fetchTrendingSongsList(),
      errorLabel: "Trending songs",
    },
    recent: {
      fetch: () => topSongsHandlers.fetchRecentSongsList(),
      errorLabel: "Recent songs",
    },
  } as const;
  const refreshCacheSafely = () => {
    cacheHandlers.refreshCacheButton().catch((err) => {
      console.warn(`Cache size failed: ${String(err)}`);
    });
  };
  const tabsHandlers = createTabsHandlers({
    elements,
    state,
    favoritesHandlers,
    navigateToTabWithState: navigationHandlers.navigateToTabWithState,
    onTopSongsTabChange: (tabId) => {
      if (!(tabId in topSongsTabLoaders)) {
        return;
      }
      const lazyTabId = tabId as LazyTopSongsTab;
      const loader = topSongsTabLoaders[lazyTabId];
      if (loadedTopSongTabs.has(lazyTabId)) {
        return;
      }
      loader
        .fetch()
        .then(() => {
          loadedTopSongTabs.add(lazyTabId);
        })
        .catch((err) => {
          console.warn(`${loader.errorLabel} load failed: ${String(err)}`);
        });
    },
    onFaqOpen: refreshCacheSafely,
  });
  const getFaqSubtabFromPath = (pathname: string): FaqSubtabId | null => {
    if (pathname.startsWith("/whats-new")) {
      return "whats-new";
    }
    if (pathname.startsWith("/faq")) {
      return "faq";
    }
    return null;
  };
  const applyFaqRouteState = (pathname: string) => {
    const faqSubtab = getFaqSubtabFromPath(pathname);
    if (!faqSubtab) {
      return;
    }
    tabsHandlers.setFaqTab(faqSubtab);
    refreshCacheSafely();
  };
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
    startUrlAnalysis,
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
    applyExtrasChanges,
    resetExtrasDefaults,
    syncExtrasUI,
    syncTuningTabsUI,
    setActiveTuningTab,
    getActiveTuningTab,
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
    onFaqRoute: (subtabId) => {
      tabsHandlers.setFaqTab(subtabId);
      refreshCacheSafely();
    },
  });
  const heroTitleHomeButton = document.querySelector<HTMLButtonElement>(
    "#hero-title-home",
  );

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
  refreshCacheSafely();

  resetForNewTrack(context);
  favoritesHandlers.syncFavoriteButton();

  playbackHandlers.applyModeFromUrl();
  handleRouteChange(context, playbackDeps, window.location.pathname)
    .then(() => {
      applyFaqRouteState(window.location.pathname);
    })
    .catch((err) => {
      console.warn(`Route load failed: ${String(err)}`);
    });

  window.addEventListener("popstate", routingHandlers.handlePopState);
  heroTitleHomeButton?.addEventListener("click", () => {
    navigationHandlers.navigateToTabWithState("top");
  });
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
