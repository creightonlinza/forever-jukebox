import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import type { FavoriteTrack } from "../favorites";
import type { AnalysisComplete } from "../api";
import type { ToastOptions } from "../ui";

type FavoritesDeps = {
  context: AppContext;
  elements: Elements;
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
    options?: { replace?: boolean; youtubeId?: string | null },
  ) => void;
  loadTrackByYouTubeId: (youtubeId: string) => void;
  loadTrackByJobId: (jobId: string) => void;
  writeTuningParamsToUrl: (tuningParams: string | null, replace?: boolean) => void;
  syncTuningParamsState: (context: AppContext) => string | null;
  setPlayMode: (mode: "jukebox" | "autocanonizer") => void;
};

export type FavoritesHandlers = ReturnType<typeof createFavoritesHandlers>;

export function createFavoritesHandlers(deps: FavoritesDeps) {
  const {
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
    navigateToTabWithState,
    loadTrackByYouTubeId,
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

  function handleFavoritesSyncToggle(event: Event) {
    event.stopPropagation();
    toggleFavoritesSyncMenu();
  }

  function handleFavoritesSyncItem(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    closeFavoritesSyncMenu();
    const action = button?.dataset.favoritesSync;
    if (action === "refresh") {
      void refreshFavoritesFromSync();
    } else if (action === "create") {
      openFavoritesSyncCreateModal();
    } else if (action === "enter") {
      openFavoritesSyncEnterModal();
    }
  }

  function handleFavoritesSyncDocumentClick(event: Event) {
    if (elements.favoritesSyncMenu.classList.contains("hidden")) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (
      elements.favoritesSyncMenu.contains(target) ||
      elements.favoritesSyncButton.contains(target)
    ) {
      return;
    }
    closeFavoritesSyncMenu();
  }

  function toggleFavoritesSyncMenu() {
    if (elements.favoritesSyncMenu.classList.contains("hidden")) {
      openFavoritesSyncMenu();
    } else {
      closeFavoritesSyncMenu();
    }
  }

  function openFavoritesSyncMenu() {
    elements.favoritesSyncMenu.classList.remove("hidden");
    elements.favoritesSyncButton.setAttribute("aria-expanded", "true");
  }

  function closeFavoritesSyncMenu() {
    elements.favoritesSyncMenu.classList.add("hidden");
    elements.favoritesSyncButton.setAttribute("aria-expanded", "false");
  }

  function updateFavoritesSyncControls() {
    const allowSync = Boolean(state.appConfig?.allow_favorites_sync);
    const hasCode = Boolean(state.favoritesSyncCode);
    const showControls = state.topSongsTab === "favorites" && allowSync;
    elements.favoritesSyncButton.classList.toggle("hidden", !showControls);
    elements.favoritesSyncIcon.textContent = hasCode ? "cloud" : "cloud_off";
    const refreshItem = getFavoritesSyncRefreshItem();
    if (refreshItem) {
      refreshItem.classList.toggle("hidden", !hasCode);
    }
    const createItem = getFavoritesSyncCreateItem();
    if (createItem) {
      createItem.textContent = hasCode ? "View sync code" : "Create sync code";
    }
  }

  function getFavoritesSyncCreateItem() {
    return elements.favoritesSyncItems.find(
      (item) => item.dataset.favoritesSync === "create",
    );
  }

  function getFavoritesSyncRefreshItem() {
    return elements.favoritesSyncItems.find(
      (item) => item.dataset.favoritesSync === "refresh",
    );
  }

  function openFavoritesSyncEnterModal() {
    closeFavoritesSyncCreateModal();
    elements.favoritesSyncEnterInput.value = "";
    clearFavoritesSyncEnterStatus();
    elements.favoritesSyncEnterModal.classList.add("open");
    elements.favoritesSyncEnterInput.focus();
  }

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

  function closeFavoritesSyncEnterModal() {
    elements.favoritesSyncEnterModal.classList.remove("open");
  }

  function openFavoritesSyncCreateModal() {
    closeFavoritesSyncEnterModal();
    resetFavoritesSyncCreateModal();
    const existingCode = state.favoritesSyncCode;
    elements.favoritesSyncCreateHint.textContent = existingCode
      ? "Enter this code on another device to sync."
      : "Create a sync code to share your favorites between devices.";
    if (existingCode) {
      elements.favoritesSyncCreateOutput.textContent = existingCode;
      elements.favoritesSyncCreateOutput.classList.remove("hidden");
      elements.favoritesSyncCreateButton.textContent = "Create new sync code";
    }
    elements.favoritesSyncCreateModal.classList.add("open");
  }

  function closeFavoritesSyncCreateModal() {
    elements.favoritesSyncCreateModal.classList.remove("open");
  }

  function resetFavoritesSyncCreateModal() {
    elements.favoritesSyncCreateButton.classList.remove("hidden");
    elements.favoritesSyncCreateButton.disabled = false;
    elements.favoritesSyncCreateButton.textContent = "Create sync code";
    elements.favoritesSyncCreateOutput.classList.add("hidden");
    elements.favoritesSyncCreateOutput.textContent = "";
    elements.favoritesSyncCreateHint.textContent =
      "Create a sync code to share your favorites between devices.";
    clearFavoritesSyncCreateStatus();
  }

  async function handleFavoritesSyncEnterSubmit() {
    const code = elements.favoritesSyncEnterInput.value.trim();
    if (!code) {
      setFavoritesSyncEnterStatus("Enter a sync code first.", true);
      return;
    }
    elements.favoritesSyncEnterButton.disabled = true;
    elements.favoritesSyncEnterButton.textContent = "Syncing...";
    setFavoritesSyncEnterStatus("Syncing favorites...");
    try {
      const items = await fetchFavoritesSync(code);
      const favorites = normalizeFavoritesFromSync(items);
      const shouldReplace = window.confirm(
        "Replace your local favorites with the synced list?",
      );
      if (shouldReplace) {
        const normalizedCode = code.trim().toLowerCase();
        state.favoritesSyncCode = normalizedCode;
        saveFavoritesSyncCode(normalizedCode);
        updateFavoritesSyncControls();
        updateFavorites(favorites, { sync: false });
        setFavoritesSyncEnterStatus("Favorites updated.");
        closeFavoritesSyncEnterModal();
      } else {
        clearFavoritesSyncEnterStatus();
      }
    } catch (err) {
      setFavoritesSyncEnterStatus("Unable to sync favorites.", true);
      console.warn(`Favorites sync failed: ${String(err)}`);
    } finally {
      elements.favoritesSyncEnterButton.disabled = false;
      elements.favoritesSyncEnterButton.textContent = "Sync favorites";
    }
  }

  async function handleFavoritesSyncCreateSubmit() {
    elements.favoritesSyncCreateButton.classList.add("hidden");
    setFavoritesSyncCreateStatus("Creating sync code...");
    try {
      const response = await createFavoritesSync(state.favorites);
      const code = response.code;
      if (!code) {
        throw new Error("Missing sync code");
      }
      state.favoritesSyncCode = code;
      saveFavoritesSyncCode(code);
      updateFavoritesSyncControls();
      if (Array.isArray(response.favorites)) {
        const normalized = normalizeFavoritesFromSync(response.favorites);
        updateFavorites(normalized, { sync: false });
      }
      elements.favoritesSyncCreateButton.classList.add("hidden");
      elements.favoritesSyncCreateOutput.textContent = code;
      elements.favoritesSyncCreateOutput.classList.remove("hidden");
      elements.favoritesSyncCreateHint.textContent =
        "Enter this code on another device to sync.";
      clearFavoritesSyncCreateStatus();
    } catch (err) {
      setFavoritesSyncCreateStatus("Unable to create sync code.", true);
      elements.favoritesSyncCreateButton.classList.remove("hidden");
      elements.favoritesSyncCreateButton.textContent = "Create sync code";
      console.warn(`Favorites sync create failed: ${String(err)}`);
    }
  }

  function handleFavoritesSyncEnterKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleFavoritesSyncEnterSubmit();
  }

  function handleFavoritesSyncEnterClose() {
    closeFavoritesSyncEnterModal();
  }

  function handleFavoritesSyncCreateClose() {
    closeFavoritesSyncCreateModal();
  }

  function handleFavoritesSyncEnterModalClick(event: MouseEvent) {
    if (event.target === elements.favoritesSyncEnterModal) {
      closeFavoritesSyncEnterModal();
    }
  }

  function handleFavoritesSyncCreateModalClick(event: MouseEvent) {
    if (event.target === elements.favoritesSyncCreateModal) {
      closeFavoritesSyncCreateModal();
    }
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
        item.sourceType === "upload" ? "upload" : ("youtube" as const);
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

  function setFavoritesSyncEnterStatus(message: string, isError = false) {
    elements.favoritesSyncEnterStatus.textContent = message;
    elements.favoritesSyncEnterStatus.classList.remove("hidden");
    elements.favoritesSyncEnterStatus.classList.toggle("error", isError);
  }

  function clearFavoritesSyncEnterStatus() {
    elements.favoritesSyncEnterStatus.textContent = "";
    elements.favoritesSyncEnterStatus.classList.add("hidden");
    elements.favoritesSyncEnterStatus.classList.remove("error");
  }

  function setFavoritesSyncCreateStatus(message: string, isError = false) {
    elements.favoritesSyncCreateStatus.textContent = message;
    elements.favoritesSyncCreateStatus.classList.remove("hidden");
    elements.favoritesSyncCreateStatus.classList.toggle("error", isError);
  }

  function clearFavoritesSyncCreateStatus() {
    elements.favoritesSyncCreateStatus.textContent = "";
    elements.favoritesSyncCreateStatus.classList.add("hidden");
    elements.favoritesSyncCreateStatus.classList.remove("error");
  }

  function updateFavorites(
    nextFavorites: FavoriteTrack[],
    options?: { sync?: boolean },
  ) {
    const prevFavorites = state.favorites;
    state.favorites = nextFavorites;
    saveFavorites(nextFavorites);
    renderFavoritesList();
    syncFavoriteButton();
    if (options?.sync === false) {
      return;
    }
    const delta = computeFavoritesDelta(prevFavorites, nextFavorites);
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
    return state.lastYouTubeId ?? state.lastJobId;
  }

  function getCurrentFavoriteSourceType(): FavoriteTrack["sourceType"] {
    return state.lastYouTubeId ? "youtube" : "upload";
  }

  function getFavoriteTuningParams() {
    if (state.playMode !== "jukebox") {
      return null;
    }
    return syncTuningParamsState(context);
  }

  function renderFavoritesList() {
    elements.favoritesList.innerHTML = "";
    if (state.favorites.length === 0) {
      elements.favoritesList.textContent = "No favorites yet.";
      return;
    }
    for (const item of state.favorites) {
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "favorite-row";
      const sourceType = item.sourceType ?? "youtube";
      const link = document.createElement("a");
      link.href = `/listen/${encodeURIComponent(item.uniqueSongId)}`;
      const titleText = item.title || "Untitled";
      const artist = (item.artist || "").trim();
      const showArtist = artist !== "" && artist !== "Unknown";
      const artistText = showArtist ? ` — ${artist}` : "";
      link.textContent = `${titleText}${artistText}`;
      if (item.tuningParams) {
        const tuneIcon = document.createElement("span");
        tuneIcon.className = "material-symbols-outlined favorite-tune-icon";
        tuneIcon.textContent = "tune";
        tuneIcon.setAttribute("aria-hidden", "true");
        tuneIcon.title = "Custom tuning";
        link.append(" ", tuneIcon);
      }
      link.dataset.favoriteId = item.uniqueSongId;
      link.dataset.sourceType = sourceType;
      link.addEventListener("click", handleFavoriteClick);
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "favorite-remove";
      removeButton.innerHTML =
        '<span class="material-symbols-outlined favorite-remove-icon" aria-hidden="true">close</span>';
      removeButton.dataset.favoriteId = item.uniqueSongId;
      removeButton.addEventListener("click", handleFavoriteRemove);
      row.append(link, removeButton);
      li.append(row);
      elements.favoritesList.appendChild(li);
    }
  }

  function syncFavoriteButton() {
    const currentId = getCurrentFavoriteId();
    const active = currentId ? isFavorite(state.favorites, currentId) : false;
    elements.favoriteButton.classList.toggle("active", active);
    const label = active ? "Remove from Favorites" : "Add to Favorites";
    elements.favoriteButton.setAttribute("aria-label", label);
    elements.favoriteButton.title = label;
  }

  function setFavoriteToggleLoading(busy: boolean) {
    elements.favoriteButton.classList.toggle("is-loading", busy);
    elements.favoriteButton.disabled = busy;
    elements.favoriteButton.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function maybeAutoFavoriteUserSupplied(response: AnalysisComplete) {
    if (!response.is_user_supplied) {
      return;
    }
    const favoriteId = response.youtube_id ?? response.id;
    if (!favoriteId || state.pendingAutoFavoriteId !== favoriteId) {
      return;
    }
    state.pendingAutoFavoriteId = null;
    if (isFavorite(state.favorites, favoriteId)) {
      return;
    }
    const title = state.trackTitle || "Untitled";
    const artist = state.trackArtist || "";
    const track: FavoriteTrack = {
      uniqueSongId: favoriteId,
      title,
      artist,
      duration: state.trackDurationSec,
      sourceType: response.youtube_id ? "youtube" : "upload",
      tuningParams: getFavoriteTuningParams(),
    };
    const result = addFavorite(state.favorites, track);
    if (result.status === "added") {
      updateFavorites(result.favorites);
    }
  }

  function handleFavoriteClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const favoriteId = target?.dataset.favoriteId;
    if (!favoriteId) {
      return;
    }
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
    const sourceType = target?.dataset.sourceType ?? "youtube";
    navigateToTabWithState("play", { youtubeId: favoriteId });
    if (sourceType === "upload") {
      loadTrackByJobId(favoriteId);
      return;
    }
    loadTrackByYouTubeId(favoriteId);
  }

  function handleFavoriteRemove(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLButtonElement | null;
    const favoriteId = target?.dataset.favoriteId;
    if (!favoriteId) {
      return;
    }
    updateFavorites(removeFavorite(state.favorites, favoriteId));
    showFavoriteToast("Removed from Favorites");
  }

  async function handleFavoriteToggle() {
    const currentId = getCurrentFavoriteId();
    if (!currentId) {
      return;
    }
    if (elements.favoriteButton.classList.contains("is-loading")) {
      return;
    }
    if (isFavorite(state.favorites, currentId)) {
      const showLoading = shouldShowFavoriteToggleLoading();
      if (showLoading) {
        setFavoriteToggleLoading(true);
      }
      try {
        updateFavorites(removeFavorite(state.favorites, currentId));
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
    handleFavoritesSyncToggle,
    handleFavoritesSyncItem,
    handleFavoritesSyncDocumentClick,
    handleFavoritesSyncEnterClose,
    handleFavoritesSyncCreateClose,
    handleFavoritesSyncEnterSubmit,
    handleFavoritesSyncCreateSubmit,
    handleFavoritesSyncEnterKeydown,
    handleFavoritesSyncEnterModalClick,
    handleFavoritesSyncCreateModalClick,
    closeFavoritesSyncMenu,
    updateFavoritesSyncControls,
    hydrateFavoritesFromSync,
    renderFavoritesList,
    syncFavoriteButton,
    maybeAutoFavoriteUserSupplied,
    handleFavoriteClick,
    handleFavoriteRemove,
    handleFavoriteToggle,
    updateFavorites,
  };
}
