import {
  createFavoritesSync,
  fetchFavoritesSync,
  updateFavoritesSync,
  type AnalysisComplete,
} from "./api";
import {
  addFavorite,
  favoriteToPlaylistTrack,
  findCurrentFavorite,
  isFavorite,
  maxFavorites,
  removeFavorite,
  saveFavorites,
  saveFavoritesSyncCode,
  sortFavorites,
  type FavoriteTrack,
} from "./favorites";
import { isLikelyJobId } from "./identity";
import { loadTrackById, loadTrackByJobId } from "./playback";
import { setPlayMode } from "./playback-ui";
import { getAppContext, getPlaybackDeps } from "./runtime";
import { useAppStore } from "./store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "./tuning";
import { showToast } from "./ui";

type FavoritesDelta = {
  added: FavoriteTrack[];
  removedIds: Set<string>;
};

let syncUpdateInFlight = false;
let pendingSyncDelta: FavoritesDelta | null = null;
let syncIdleWaiters: Array<() => void> = [];

export function toggleFavorite(): void {
  void handleFavoriteToggle();
}

export function selectFavorite(
  favoriteId: string,
  sourceType: FavoriteTrack["sourceType"],
): void {
  handleFavoriteSelect(favoriteId, sourceType);
}

// Favorites state machine + the Listen-panel star button. The Top Tracks
// panel (lists, sync menu, sync modals) is React; it renders from the store
// and calls into these handlers directly.
export function resetFavoritesActionsForTest(): void {
  syncUpdateInFlight = false;
  pendingSyncDelta = null;
  syncIdleWaiters = [];
}

export async function hydrateFavoritesFromSync() {
    if (!useAppStore.getState().appConfig?.allow_favorites_sync) {
      return;
    }
    const code = useAppStore.getState().favoritesSyncCode;
    if (!code) {
      return;
    }
    try {
      await refreshFavoritesFromSync();
    } catch (err) {
      console.warn(`Favorites sync hydrate failed: ${String(err)}`);
      showToast("Favorites sync failed.");
    }
  }

export async function refreshFavoritesFromSync() {
    if (!useAppStore.getState().appConfig?.allow_favorites_sync) {
      return;
    }
    const code = useAppStore.getState().favoritesSyncCode;
    if (!code) {
      return;
    }
    try {
      const items = await fetchFavoritesSync(code);
      const favorites = normalizeFavoritesFromSync(items);
      updateFavorites(favorites, { sync: false });
      showToast("Favorites refreshed.", { icon: "cloud_done" });
    } catch (err) {
      console.warn(`Favorites sync refresh failed: ${String(err)}`);
      showToast("Favorites sync failed.");
    }
  }

  // Fetches the synced list, confirms with the user, then replaces local
  // favorites and stores the code. The React enter-modal renders statuses.
export async function enterSyncCode(
  code: string,
): Promise<"replaced" | "cancelled"> {
    const items = await fetchFavoritesSync(code);
    const favorites = normalizeFavoritesFromSync(items);
    const shouldReplace = window.confirm(
      "Replace your local favorites with the synced list?",
    );
    if (!shouldReplace) {
      return "cancelled";
    }
    const normalizedCode = code.trim().toLowerCase();
    useAppStore.setState({ favoritesSyncCode: normalizedCode });
    saveFavoritesSyncCode(normalizedCode);
    updateFavorites(favorites, { sync: false });
    return "replaced";
  }

export async function createSyncCode(): Promise<string> {
    const response = await createFavoritesSync(useAppStore.getState().favorites);
    const code = response.code;
    if (!code) {
      throw new Error("Missing sync code");
    }
    useAppStore.setState({ favoritesSyncCode: code });
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
      const entry: FavoriteTrack = {
        uniqueSongId: item.uniqueSongId,
        title,
        artist,
        duration,
        sourceType,
        tuningParams,
      };
      // Only the non-default mode is stored; absence means jukebox.
      if (item.playMode === "autocanonizer") {
        entry.playMode = "autocanonizer";
      }
      normalized.push(entry);
    }
    return sortFavorites(normalized).slice(0, maxFavorites());
  }

  // React renders the favorites list from the store, so updating state is
  // enough; only the Listen-panel star still needs an imperative sync.
export function updateFavorites(
    nextFavorites: FavoriteTrack[],
    options?: { sync?: boolean },
  ) {
    const prevFavorites = useAppStore.getState().favorites;
    const cappedFavorites = sortFavorites(nextFavorites).slice(0, maxFavorites());
    useAppStore.setState({ favorites: cappedFavorites });
    saveFavorites(cappedFavorites);
    if (options?.sync === false) {
      return;
    }
    const delta = computeFavoritesDelta(prevFavorites, cappedFavorites);
    scheduleFavoritesSync(delta);
  }

  function scheduleFavoritesSync(delta: FavoritesDelta) {
    if (!useAppStore.getState().appConfig?.allow_favorites_sync) {
      return;
    }
    if (!useAppStore.getState().favoritesSyncCode) {
      return;
    }
    if (syncUpdateInFlight) {
      // Merge rather than replace: a second local change while a sync is in
      // flight must not clobber the first, or the server echo deletes it
      // back out locally.
      pendingSyncDelta = pendingSyncDelta
        ? mergeFavoritesDeltas(pendingSyncDelta, delta)
        : delta;
      return;
    }
    void syncFavoritesToBackend(delta);
  }

  // Fold a later delta into an earlier queued one so the combined effect is
  // applied atomically on the next flush. `added` unions by key; `removedIds`
  // unions; a later add cancels an earlier remove and vice versa.
  function mergeFavoritesDeltas(
    base: FavoritesDelta,
    next: FavoritesDelta,
  ): FavoritesDelta {
    const removedIds = new Set<string>(base.removedIds);
    next.removedIds.forEach((id) => removedIds.add(id));
    next.added.forEach((item) => removedIds.delete(item.uniqueSongId));

    const addedById = new Map<string, FavoriteTrack>();
    base.added.forEach((item) => addedById.set(item.uniqueSongId, item));
    next.added.forEach((item) => addedById.set(item.uniqueSongId, item));
    removedIds.forEach((id) => addedById.delete(id));

    return { added: [...addedById.values()], removedIds };
  }

  async function syncFavoritesToBackend(delta: FavoritesDelta) {
    syncUpdateInFlight = true;
    try {
      const code = useAppStore.getState().favoritesSyncCode;
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
      showToast("Favorites sync failed.");
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
    if (!useAppStore.getState().appConfig?.allow_favorites_sync || !useAppStore.getState().favoritesSyncCode) {
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
    return Boolean(useAppStore.getState().appConfig?.allow_favorites_sync && useAppStore.getState().favoritesSyncCode);
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
    return useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId;
  }

  function getCurrentFavoriteMatch() {
    return findCurrentFavorite(useAppStore.getState().favorites, {
      lastTrackId: useAppStore.getState().lastTrackId,
      lastJobId: useAppStore.getState().lastJobId,
      lastSourceId: useAppStore.getState().lastSourceId,
      lastSourceProvider: useAppStore.getState().lastSourceProvider,
    });
  }

  function getCurrentFavoriteSourceType(): FavoriteTrack["sourceType"] {
    const sourceProvider = useAppStore.getState().lastSourceProvider;
    if (
      sourceProvider === "upload" ||
      sourceProvider === "youtube" ||
      sourceProvider === "soundcloud" ||
      sourceProvider === "bandcamp"
    ) {
      return sourceProvider;
    }
    if (!useAppStore.getState().lastTrackId) {
      return "upload";
    }
    return "youtube";
  }

  function getFavoriteTuningParams() {
    if (useAppStore.getState().playMode !== "jukebox") {
      return null;
    }
    return syncTuningParamsState(getAppContext());
  }

  // The React play menu derives the star button from the store
  // (findCurrentFavorite + favoriteToggleBusy).
  function setFavoriteToggleLoading(busy: boolean) {
    useAppStore.setState({ favoriteToggleBusy: busy });
  }

export function maybeAutoFavoriteUserSupplied(response: AnalysisComplete) {
    migrateOlderFavoriteFromResponse(response);
    const provider =
      response.source_provider === "upload" ||
      response.source_provider === "youtube" ||
      response.source_provider === "soundcloud" ||
      response.source_provider === "bandcamp"
        ? response.source_provider
        : null;
    const favoriteId = response.id;
    if (!favoriteId || useAppStore.getState().pendingAutoFavoriteId !== favoriteId) {
      return;
    }
    useAppStore.setState({ pendingAutoFavoriteId: null });
    if (isFavorite(useAppStore.getState().favorites, favoriteId)) {
      return;
    }
    const title = useAppStore.getState().trackTitle || "Untitled";
    const artist = useAppStore.getState().trackArtist || "";
    const inferredSourceType = provider ?? sourceTypeFromAnalysis(response) ?? "upload";
    const track: FavoriteTrack = {
      uniqueSongId: favoriteId,
      title,
      artist,
      duration: useAppStore.getState().trackDurationSec,
      sourceType: inferredSourceType,
      tuningParams: getFavoriteTuningParams(),
    };
    const result = addFavorite(useAppStore.getState().favorites, track);
    if (result.status === "added") {
      updateFavorites(result.favorites);
    }
  }

  function migrateOlderFavoriteFromResponse(response: AnalysisComplete) {
    const jobId = response.id;
    const olderId = olderFavoriteIdFromResponse(response);
    if (!jobId || !olderId) {
      return;
    }
    const olderFavorite = useAppStore.getState().favorites.find(
      (item) =>
        item.uniqueSongId === olderId &&
        (item.sourceType ?? "youtube") === "youtube",
    );
    if (!olderFavorite) {
      return;
    }
    const existingJobFavorite = useAppStore.getState().favorites.find(
      (item) => item.uniqueSongId === jobId,
    );
    if (existingJobFavorite) {
      updateFavorites(
        useAppStore.getState().favorites.filter((item) => item.uniqueSongId !== olderId),
      );
      return;
    }
    const migrated: FavoriteTrack = {
      ...olderFavorite,
      uniqueSongId: jobId,
      sourceType: sourceTypeFromAnalysis(response) ?? olderFavorite.sourceType ?? "youtube",
      title: useAppStore.getState().trackTitle || olderFavorite.title || "Untitled",
      artist: useAppStore.getState().trackArtist || olderFavorite.artist || "",
      duration: useAppStore.getState().trackDurationSec ?? olderFavorite.duration,
    };
    updateFavorites(
      useAppStore.getState().favorites.map((item) =>
        item.uniqueSongId === olderId ? migrated : item,
      ),
    );
  }

  function olderFavoriteIdFromResponse(response: AnalysisComplete) {
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
    const favorite = useAppStore.getState().favorites.find(
      (item) => item.uniqueSongId === favoriteId,
    );
    // Restore the mode the track was favorited in (older favorites have no
    // playMode and fall back to jukebox). setPlayMode runs before the play-tab
    // navigation below, so navigateToTabWithState serializes the right mode.
    const desiredMode =
      favorite?.playMode === "autocanonizer" ? "autocanonizer" : "jukebox";
    const desiredTuningParams =
      desiredMode === "jukebox" ? (favorite?.tuningParams ?? null) : null;
    if (useAppStore.getState().playMode !== desiredMode) {
      setPlayMode(desiredMode);
    }
    useAppStore.setState({ tuningParams: desiredTuningParams });
    if (desiredMode === "jukebox") {
      writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
    }
    const sourceType: FavoriteTrack["sourceType"] =
      sourceTypeRaw === "upload" ||
      sourceTypeRaw === "youtube" ||
      sourceTypeRaw === "soundcloud" ||
      sourceTypeRaw === "bandcamp"
        ? sourceTypeRaw
        : "youtube";
    useAppStore
      .getState()
      .navigateToTabWithState("play", { trackId: favoriteId });
    const selectedTrack = favorite
      ? favoriteToPlaylistTrack(favorite, sourceType)
      : null;
    const deps = getPlaybackDeps();
    if (!deps) {
      return;
    }
    const context = getAppContext();
    if (sourceType === "upload" || isLikelyJobId(favoriteId)) {
      void loadTrackByJobId(context, deps, favoriteId, {
        preserveUrlTuning: true,
        selectedTrack,
      });
      return;
    }
    void loadTrackById(context, deps, favoriteId, {
      preserveUrlTuning: true,
      selectedTrack,
    });
  }

export function removeFavoriteWithToast(favoriteId: string) {
    updateFavorites(removeFavorite(useAppStore.getState().favorites, favoriteId));
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
        updateFavorites(removeFavorite(useAppStore.getState().favorites, currentFavorite.uniqueSongId));
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
    const title = useAppStore.getState().trackTitle || "Untitled";
    const artist = useAppStore.getState().trackArtist || "";
    const track: FavoriteTrack = {
      uniqueSongId: currentId,
      title,
      artist,
      duration: useAppStore.getState().trackDurationSec,
      sourceType: getCurrentFavoriteSourceType(),
      tuningParams: getFavoriteTuningParams(),
      // Only the non-default mode is stored; absence means jukebox.
      playMode:
        useAppStore.getState().playMode === "autocanonizer"
          ? "autocanonizer"
          : undefined,
    };
    const result = addFavorite(useAppStore.getState().favorites, track);
    if (result.status === "limit") {
      showToast(`Maximum favorites reached (${maxFavorites()}).`);
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
        showToast("Favorited");
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
    if (useAppStore.getState().favoritesSyncCode) {
      showToast(message, { icon: "cloud_done" });
    } else {
      showToast(message);
    }
  }
