import type { AppContext, AppState, TabId } from "../context";
import {
  favoriteToPlaylistTrack,
  findCurrentFavorite,
  type FavoriteTrack,
} from "../favorites";
import type { AnalysisComplete } from "../api";
import { isLikelyJobId } from "../identity";
import { useAppStore } from "../store";
import type { ToastOptions } from "../ui";
import type { PlaylistTrack } from "../playlist";

type FavoritesDeps = {
  context: AppContext;
  state: AppState;
  showToast: (context: AppContext, message: string, options?: ToastOptions) => void;
  addFavorite: (
    items: FavoriteTrack[],
    track: FavoriteTrack,
  ) => { favorites: FavoriteTrack[]; status: "added" | "duplicate" | "limit" };
  removeFavorite: (items: FavoriteTrack[], uniqueSongId: string) => FavoriteTrack[];
  isFavorite: (items: FavoriteTrack[], uniqueSongId: string) => boolean;
  sortFavorites: (items: FavoriteTrack[]) => FavoriteTrack[];
  maxFavorites: () => number;
  saveFavorites: (items: FavoriteTrack[]) => void;
  saveFavoritesSyncCode: (code: string) => void;
  fetchFavoritesSync: (code: string) => Promise<FavoriteTrack[]>;
  createFavoritesSync: (favorites: FavoriteTrack[]) => Promise<{
    code?: string;
    favorites?: FavoriteTrack[];
  }>;
  updateFavoritesSync: (code: string, favorites: FavoriteTrack[]) => Promise<{
    favorites?: FavoriteTrack[];
  }>;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  loadTrackById: (
    trackId: string,
    options?: { selectedTrack?: PlaylistTrack | null },
  ) => void;
  loadTrackByJobId: (
    jobId: string,
    options?: { selectedTrack?: PlaylistTrack | null },
  ) => void;
  writeTuningParamsToUrl: (tuningParams: string | null, replace?: boolean) => void;
  syncTuningParamsState: (context: AppContext) => string | null;
  setPlayMode: (mode: "jukebox" | "autocanonizer") => void;
};

export type FavoritesHandlers = ReturnType<typeof createFavoritesHandlers>;

// Favorites state machine + the Listen-panel star button. The Top Tracks
// panel (lists, sync menu, sync modals) is React; it renders from the store
// and calls into these handlers through bridge.topPanel.
export function createFavoritesHandlers(deps: FavoritesDeps) {
  const {
    context,
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
    navigateToTabWithState,
    loadTrackById,
    loadTrackByJobId,
    writeTuningParamsToUrl,
    syncTuningParamsState,
    setPlayMode,
  } = deps;

  type FavoritesDelta = {
    added: FavoriteTrack[];
    removedIds: Set<string>;
  };

  let syncUpdateInFlight = false;
  let pendingSyncDelta: FavoritesDelta | null = null;
  let syncIdleWaiters: Array<() => void> = [];

  async function hydrateFavoritesFromSync() {
    if (!state.appConfig?.allow_favorites_sync) {
      return;
    }
    const code = state.favoritesSyncCode;
    if (!code) {
      return;
    }
    try {
      await refreshFavoritesFromSync();
    } catch (err) {
      console.warn(`Favorites sync hydrate failed: ${String(err)}`);
      showToast(context, "Favorites sync failed.");
    }
  }

  async function refreshFavoritesFromSync() {
    if (!state.appConfig?.allow_favorites_sync) {
      return;
    }
    const code = state.favoritesSyncCode;
    if (!code) {
      return;
    }
    try {
      const items = await fetchFavoritesSync(code);
      const favorites = normalizeFavoritesFromSync(items);
      updateFavorites(favorites, { sync: false });
      showToast(context, "Favorites refreshed.", { icon: "cloud_done" });
    } catch (err) {
      console.warn(`Favorites sync refresh failed: ${String(err)}`);
      showToast(context, "Favorites sync failed.");
    }
  }

  // Fetches the synced list, confirms with the user, then replaces local
  // favorites and stores the code. The React enter-modal renders statuses.
  async function enterSyncCode(code: string): Promise<"replaced" | "cancelled"> {
    const items = await fetchFavoritesSync(code);
    const favorites = normalizeFavoritesFromSync(items);
    const shouldReplace = window.confirm(
      "Replace your local favorites with the synced list?",
    );
    if (!shouldReplace) {
      return "cancelled";
    }
    const normalizedCode = code.trim().toLowerCase();
    state.favoritesSyncCode = normalizedCode;
    saveFavoritesSyncCode(normalizedCode);
    updateFavorites(favorites, { sync: false });
    return "replaced";
  }

  async function createSyncCode(): Promise<string> {
    const response = await createFavoritesSync(state.favorites);
    const code = response.code;
    if (!code) {
      throw new Error("Missing sync code");
    }
    state.favoritesSyncCode = code;
    saveFavoritesSyncCode(code);
    if (Array.isArray(response.favorites)) {
      const normalized = normalizeFavoritesFromSync(response.favorites);
      updateFavorites(normalized, { sync: false });
    }
    return code;
  }

  function normalizeFavoritesFromSync(items: FavoriteTrack[]) {
    const normalized: FavoriteTrack[] = [];
    for (const item of items) {
      if (!item || typeof item.uniqueSongId !== "string") {
        continue;
      }
      const title =
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : "Untitled";
      const artist = typeof item.artist === "string" ? item.artist : "";
      const duration =
        typeof item.duration === "number" && Number.isFinite(item.duration)
          ? item.duration
          : null;
      const sourceType =
        item.sourceType === "upload" ||
          item.sourceType === "youtube" ||
          item.sourceType === "soundcloud" ||
          item.sourceType === "bandcamp"
          ? item.sourceType
          : "youtube";
      const tuningParams =
        typeof item.tuningParams === "string" && item.tuningParams.trim()
          ? item.tuningParams.trim()
          : null;
      normalized.push({
        uniqueSongId: item.uniqueSongId,
        title,
        artist,
        duration,
        sourceType,
        tuningParams,
      });
    }
    return sortFavorites(normalized).slice(0, maxFavorites());
  }

  // React renders the favorites list from the store, so updating state is
  // enough; only the Listen-panel star still needs an imperative sync.
  function updateFavorites(
    nextFavorites: FavoriteTrack[],
    options?: { sync?: boolean },
  ) {
    const prevFavorites = state.favorites;
    const cappedFavorites = sortFavorites(nextFavorites).slice(0, maxFavorites());
    state.favorites = cappedFavorites;
    saveFavorites(cappedFavorites);
    if (options?.sync === false) {
      return;
    }
    const delta = computeFavoritesDelta(prevFavorites, cappedFavorites);
    scheduleFavoritesSync(delta);
  }

  function scheduleFavoritesSync(delta: FavoritesDelta) {
    if (!state.appConfig?.allow_favorites_sync) {
      return;
    }
    if (!state.favoritesSyncCode) {
      return;
    }
    if (syncUpdateInFlight) {
      pendingSyncDelta = delta;
      return;
    }
    void syncFavoritesToBackend(delta);
  }

  async function syncFavoritesToBackend(delta: FavoritesDelta) {
    syncUpdateInFlight = true;
    try {
      const code = state.favoritesSyncCode;
      if (!code) {
        return;
      }
      const remoteItems = await fetchFavoritesSync(code);
      const serverFavorites = normalizeFavoritesFromSync(remoteItems);
      const merged = applyFavoritesDelta(serverFavorites, delta);
      const response = await updateFavoritesSync(code, merged);
      if (Array.isArray(response.favorites)) {
        const normalized = normalizeFavoritesFromSync(response.favorites);
        updateFavorites(normalized, { sync: false });
      }
    } catch (err) {
      console.warn(`Favorites sync update failed: ${String(err)}`);
      showToast(context, "Favorites sync failed.");
    } finally {
      syncUpdateInFlight = false;
      if (pendingSyncDelta) {
        const nextDelta = pendingSyncDelta;
        pendingSyncDelta = null;
        void syncFavoritesToBackend(nextDelta);
      } else {
        resolveSyncIdleWaiters();
      }
    }
  }

  function resolveSyncIdleWaiters() {
    if (syncUpdateInFlight || pendingSyncDelta || syncIdleWaiters.length === 0) {
      return;
    }
    const waiters = syncIdleWaiters;
    syncIdleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function waitForFavoritesSyncIdle() {
    if (!state.appConfig?.allow_favorites_sync || !state.favoritesSyncCode) {
      return Promise.resolve();
    }
    if (!syncUpdateInFlight && !pendingSyncDelta) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      syncIdleWaiters.push(resolve);
    });
  }

  function shouldShowFavoriteToggleLoading() {
    return Boolean(state.appConfig?.allow_favorites_sync && state.favoritesSyncCode);
  }

  function computeFavoritesDelta(
    prevFavorites: FavoriteTrack[],
    nextFavorites: FavoriteTrack[],
  ): FavoritesDelta {
    const prevMap = new Map<string, FavoriteTrack>();
    const nextMap = new Map<string, FavoriteTrack>();
    prevFavorites.forEach((item) => prevMap.set(item.uniqueSongId, item));
    nextFavorites.forEach((item) => nextMap.set(item.uniqueSongId, item));
    const added: FavoriteTrack[] = [];
    const removedIds = new Set<string>();
    for (const key of prevMap.keys()) {
      if (!nextMap.has(key)) {
        removedIds.add(key);
      }
    }
    for (const [key, item] of nextMap.entries()) {
      if (!prevMap.has(key)) {
        added.push(item);
      }
    }
    return { added, removedIds };
  }

  function applyFavoritesDelta(
    serverFavorites: FavoriteTrack[],
    delta: FavoritesDelta,
  ): FavoriteTrack[] {
    let next = serverFavorites.filter(
      (item) => !delta.removedIds.has(item.uniqueSongId),
    );
    for (const favorite of delta.added) {
      if (next.find((item) => item.uniqueSongId === favorite.uniqueSongId)) {
        continue;
      }
      next.push(favorite);
    }
    return sortFavorites(next).slice(0, maxFavorites());
  }

  function getCurrentFavoriteId() {
    return state.lastTrackId ?? state.lastJobId;
  }

  function getCurrentFavoriteMatch() {
    return findCurrentFavorite(state.favorites, {
      lastTrackId: state.lastTrackId,
      lastJobId: state.lastJobId,
      lastSourceId: state.lastSourceId,
      lastSourceProvider: state.lastSourceProvider,
    });
  }

  function getCurrentFavoriteSourceType(): FavoriteTrack["sourceType"] {
    const sourceProvider = state.lastSourceProvider;
    if (
      sourceProvider === "upload" ||
      sourceProvider === "youtube" ||
      sourceProvider === "soundcloud" ||
      sourceProvider === "bandcamp"
    ) {
      return sourceProvider;
    }
    if (!state.lastTrackId) {
      return "upload";
    }
    return "youtube";
  }

  function getFavoriteTuningParams() {
    if (state.playMode !== "jukebox") {
      return null;
    }
    return syncTuningParamsState(context);
  }

  // The React play menu derives the star button from the store
  // (findCurrentFavorite + favoriteToggleBusy).
  function setFavoriteToggleLoading(busy: boolean) {
    useAppStore.setState({ favoriteToggleBusy: busy });
  }

  function maybeAutoFavoriteUserSupplied(response: AnalysisComplete) {
    migrateLegacyFavoriteFromResponse(response);
    const provider =
      response.source_provider === "upload" ||
      response.source_provider === "youtube" ||
      response.source_provider === "soundcloud" ||
      response.source_provider === "bandcamp"
        ? response.source_provider
        : null;
    const favoriteId = response.id;
    if (!favoriteId || state.pendingAutoFavoriteId !== favoriteId) {
      return;
    }
    state.pendingAutoFavoriteId = null;
    if (isFavorite(state.favorites, favoriteId)) {
      return;
    }
    const title = state.trackTitle || "Untitled";
    const artist = state.trackArtist || "";
    const inferredSourceType = provider ?? sourceTypeFromAnalysis(response) ?? "upload";
    const track: FavoriteTrack = {
      uniqueSongId: favoriteId,
      title,
      artist,
      duration: state.trackDurationSec,
      sourceType: inferredSourceType,
      tuningParams: getFavoriteTuningParams(),
    };
    const result = addFavorite(state.favorites, track);
    if (result.status === "added") {
      updateFavorites(result.favorites);
    }
  }

  function migrateLegacyFavoriteFromResponse(response: AnalysisComplete) {
    const jobId = response.id;
    const legacyId = legacyFavoriteIdFromResponse(response);
    if (!jobId || !legacyId) {
      return;
    }
    const legacyFavorite = state.favorites.find(
      (item) =>
        item.uniqueSongId === legacyId &&
        (item.sourceType ?? "youtube") === "youtube",
    );
    if (!legacyFavorite) {
      return;
    }
    const existingJobFavorite = state.favorites.find(
      (item) => item.uniqueSongId === jobId,
    );
    if (existingJobFavorite) {
      updateFavorites(
        state.favorites.filter((item) => item.uniqueSongId !== legacyId),
      );
      return;
    }
    const migrated: FavoriteTrack = {
      ...legacyFavorite,
      uniqueSongId: jobId,
      sourceType: sourceTypeFromAnalysis(response) ?? legacyFavorite.sourceType ?? "youtube",
      title: state.trackTitle || legacyFavorite.title || "Untitled",
      artist: state.trackArtist || legacyFavorite.artist || "",
      duration: state.trackDurationSec ?? legacyFavorite.duration,
    };
    updateFavorites(
      state.favorites.map((item) =>
        item.uniqueSongId === legacyId ? migrated : item,
      ),
    );
  }

  function legacyFavoriteIdFromResponse(response: AnalysisComplete) {
    if (
      response.source_provider &&
      response.source_provider !== "youtube"
    ) {
      return null;
    }
    const sourceId = response.source_id;
    if (!sourceId || sourceId === response.id || isLikelyJobId(sourceId)) {
      return null;
    }
    return sourceId;
  }

  function sourceTypeFromAnalysis(response: AnalysisComplete): FavoriteTrack["sourceType"] | null {
    if (
      response.source_provider === "upload" ||
      response.source_provider === "youtube" ||
      response.source_provider === "soundcloud" ||
      response.source_provider === "bandcamp"
    ) {
      return response.source_provider;
    }
    if (response.source_id) {
      return "youtube";
    }
    return null;
  }

  // Selecting a favorite row in the React panel: apply its tuning params,
  // navigate to the play tab and load it (job id vs source id aware).
  function handleFavoriteSelect(
    favoriteId: string,
    sourceTypeRaw: string,
  ) {
    const favorite = state.favorites.find(
      (item) => item.uniqueSongId === favoriteId,
    );
    const desiredTuningParams = favorite?.tuningParams ?? null;
    if (desiredTuningParams && state.playMode !== "jukebox") {
      setPlayMode("jukebox");
    }
    state.tuningParams =
      state.playMode === "jukebox" ? desiredTuningParams : null;
    if (state.playMode === "jukebox") {
      writeTuningParamsToUrl(state.tuningParams, true);
    }
    const sourceType: FavoriteTrack["sourceType"] =
      sourceTypeRaw === "upload" ||
      sourceTypeRaw === "youtube" ||
      sourceTypeRaw === "soundcloud" ||
      sourceTypeRaw === "bandcamp"
        ? sourceTypeRaw
        : "youtube";
    navigateToTabWithState("play", { trackId: favoriteId });
    const selectedTrack = favorite
      ? favoriteToPlaylistTrack(favorite, sourceType)
      : null;
    if (sourceType === "upload" || isLikelyJobId(favoriteId)) {
      loadTrackByJobId(favoriteId, { selectedTrack });
      return;
    }
    loadTrackById(favoriteId, { selectedTrack });
  }

  function removeFavoriteWithToast(favoriteId: string) {
    updateFavorites(removeFavorite(state.favorites, favoriteId));
    showFavoriteToast("Removed from Favorites");
  }

  async function handleFavoriteToggle() {
    const currentId = getCurrentFavoriteId();
    if (!currentId) {
      return;
    }
    if (useAppStore.getState().favoriteToggleBusy) {
      return;
    }
    const currentFavorite = getCurrentFavoriteMatch();
    if (currentFavorite) {
      const showLoading = shouldShowFavoriteToggleLoading();
      if (showLoading) {
        setFavoriteToggleLoading(true);
      }
      try {
        updateFavorites(removeFavorite(state.favorites, currentFavorite.uniqueSongId));
        showFavoriteToast("Removed from Favorites");
        if (showLoading) {
          await waitForFavoritesSyncIdle();
        }
      } finally {
        if (showLoading) {
          setFavoriteToggleLoading(false);
        }
      }
      return;
    }
    const title = state.trackTitle || "Untitled";
    const artist = state.trackArtist || "";
    const track: FavoriteTrack = {
      uniqueSongId: currentId,
      title,
      artist,
      duration: state.trackDurationSec,
      sourceType: getCurrentFavoriteSourceType(),
      tuningParams: getFavoriteTuningParams(),
    };
    const result = addFavorite(state.favorites, track);
    if (result.status === "limit") {
      showToast(context, `Maximum favorites reached (${maxFavorites()}).`);
      return;
    }
    const showLoading = shouldShowFavoriteToggleLoading();
    if (showLoading) {
      setFavoriteToggleLoading(true);
    }
    try {
      updateFavorites(result.favorites);
      if (result.status === "added") {
        showFavoriteToast("Added to Favorites");
      } else {
        showToast(context, "Favorited");
      }
      if (showLoading) {
        await waitForFavoritesSyncIdle();
      }
    } finally {
      if (showLoading) {
        setFavoriteToggleLoading(false);
      }
    }
  }

  function showFavoriteToast(message: string) {
    if (state.favoritesSyncCode) {
      showToast(context, message, { icon: "cloud_done" });
    } else {
      showToast(context, message);
    }
  }

  return {
    hydrateFavoritesFromSync,
    refreshFavoritesFromSync,
    enterSyncCode,
    createSyncCode,
    maybeAutoFavoriteUserSupplied,
    handleFavoriteSelect,
    removeFavoriteWithToast,
    handleFavoriteToggle,
    updateFavorites,
  };
}
