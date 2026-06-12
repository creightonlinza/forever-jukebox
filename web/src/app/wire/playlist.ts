import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import { isLikelyJobId } from "../identity";
import {
  activatePlaylistTrack,
  addPlaylistTrack,
  canMovePlaylistNext,
  canMovePlaylistPrevious,
  emptyPlaylist,
  hasActivePlaylistControls,
  hasInactiveSavedPlaylist,
  hasPlaylistControls,
  isPlaylistActive,
  removePlaylistTrack,
  replaceActivePlaylistTrack,
  savePlaylist,
  type PlaylistTrack,
} from "../playlist";
import { syncTuningParamsState, writeTuningParamsToUrl } from "../tuning";
import type { ToastOptions } from "../ui";

type PlaylistDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  showToast: (
    context: AppContext,
    message: string,
    options?: ToastOptions,
  ) => void;
  loadTrackById: (
    trackId: string,
    options?: {
      preserveUrlTuning?: boolean;
      playlistLoad?: boolean;
      selectedTrack?: PlaylistTrack | null;
    },
  ) => Promise<boolean | void>;
  loadTrackByJobId: (
    jobId: string,
    options?: {
      preserveUrlTuning?: boolean;
      playlistLoad?: boolean;
      selectedTrack?: PlaylistTrack | null;
    },
  ) => Promise<boolean | void>;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  togglePlayback: (context: AppContext) => void;
};

export type PlaylistHandlers = ReturnType<typeof createPlaylistHandlers>;

export function createPlaylistHandlers(deps: PlaylistDeps) {
  const {
    context,
    elements,
    state,
    showToast,
    loadTrackById,
    loadTrackByJobId,
    navigateToTabWithState,
    togglePlayback,
  } = deps;
  let playlistLoadInFlight = false;

  function getCurrentPlaylistTrack(): PlaylistTrack | null {
    const id = getCurrentPlaylistTrackId();
    if (!id) {
      return null;
    }
    const sourceType = getCurrentPlaylistSourceType();
    const tuningParams = getCurrentTuningParams();
    return {
      id,
      sourceType,
      title: state.trackTitle || "Untitled",
      artist: state.trackArtist || "",
      duration: state.trackDurationSec,
      tuningParams,
    };
  }

  function getCurrentPlaylistTrackId() {
    const rawId = state.lastTrackId ?? state.lastJobId;
    if (!rawId) {
      return null;
    }
    const provider = state.lastSourceProvider;
    if ((provider === "soundcloud" || provider === "bandcamp") && state.lastTrackId) {
      const prefix = `${provider}:`;
      return state.lastTrackId.startsWith(prefix)
        ? state.lastTrackId.slice(prefix.length)
        : state.lastTrackId;
    }
    if (provider === "upload") {
      return state.lastJobId ?? rawId;
    }
    return rawId;
  }

  function getCurrentPlaylistSourceType(): PlaylistTrack["sourceType"] {
    const provider = state.lastSourceProvider;
    if (
      provider === "youtube" ||
      provider === "soundcloud" ||
      provider === "bandcamp" ||
      provider === "upload"
    ) {
      return provider;
    }
    return "youtube";
  }

  function handleNormalTrackSelected(track: PlaylistTrack) {
    if (isPlaylistActive(state.playlist)) {
      updatePlaylist(replaceActivePlaylistTrack(state.playlist, track));
      return;
    }
    if (hasInactiveSavedPlaylist(state.playlist)) {
      updatePlaylist(emptyPlaylist());
    }
  }

  function handleAddToPlaylist(track: PlaylistTrack) {
    const result = addPlaylistTrack(
      state.playlist,
      getCurrentPlaylistTrack(),
      track,
    );
    if (result.status === "no-current") {
      showToast(context, "Load a track before starting a playlist.");
      return;
    }
    if (result.status === "duplicate") {
      showToast(context, "Already in playlist");
      return;
    }
    if (result.status === "full") {
      showToast(context, "Playlist is full.");
      return;
    }
    if (result.status === "invalid") {
      showToast(context, "Track cannot be added to playlist.");
      return;
    }
    updatePlaylist(result.playlist);
    showToast(context, "Added to playlist", { icon: "playlist_add_check" });
  }

  function handleOpenPlaylist() {
    renderPlaylistModal();
    elements.playlistModal.classList.add("open");
  }

  function handleClosePlaylist() {
    elements.playlistModal.classList.remove("open");
  }

  function handlePlaylistModalClick(event: MouseEvent) {
    if (event.target === elements.playlistModal) {
      handleClosePlaylist();
    }
  }

  function handlePlaylistModalKeydown(event: KeyboardEvent) {
    if (
      event.key === "Escape" &&
      elements.playlistModal.classList.contains("open")
    ) {
      handleClosePlaylist();
    }
  }

  function handleClearPlaylist() {
    updatePlaylist(emptyPlaylist());
    handleClosePlaylist();
  }

  function handleSavedPlaylistClick() {
    handleOpenPlaylist();
  }

  function handlePlaylistPrevious() {
    if (!canMovePlaylistPrevious(state.playlist) || isPlaylistLoadBlocked()) {
      return;
    }
    void loadPlaylistIndex(state.playlist.currentIndex - 1, {
      playAfterLoad: state.isRunning,
    });
  }

  function handlePlaylistNext() {
    if (!canMovePlaylistNext(state.playlist) || isPlaylistLoadBlocked()) {
      return;
    }
    void loadPlaylistIndex(state.playlist.currentIndex + 1, {
      playAfterLoad: state.isRunning,
    });
  }

  async function advanceAutocanonizerOnEnded() {
    if (!canMovePlaylistNext(state.playlist) || isPlaylistLoadBlocked()) {
      return false;
    }
    return await loadPlaylistIndex(state.playlist.currentIndex + 1, {
      playAfterLoad: true,
    });
  }

  async function loadPlaylistIndex(
    index: number,
    options?: { playAfterLoad?: boolean; closeModal?: boolean },
  ): Promise<boolean> {
    const track = state.playlist.tracks[index];
    if (index === state.playlist.currentIndex || !track || isPlaylistLoadBlocked()) {
      syncPlaylistUi();
      return false;
    }
    if (options?.closeModal) {
      handleClosePlaylist();
    }
    const previousPlaylist = state.playlist;
    playlistLoadInFlight = true;
    updatePlaylist(activatePlaylistTrack(state.playlist, index));
    applyTrackTuning(track);
    navigateToTabWithState("play", { trackId: getPlaylistListenId(track) });
    let loadStarted = false;
    try {
      const result =
        track.sourceType === "upload" || isLikelyJobId(track.id)
          ? await loadTrackByJobId(track.id, {
              preserveUrlTuning: true,
              playlistLoad: true,
              selectedTrack: track,
            })
          : await loadTrackById(getPlaylistLoadId(track), {
              preserveUrlTuning: true,
              playlistLoad: true,
              selectedTrack: track,
            });
      loadStarted = result !== false;
    } catch {
      loadStarted = false;
    } finally {
      playlistLoadInFlight = false;
    }
    if (!loadStarted) {
      updatePlaylist(previousPlaylist);
      return false;
    }
    syncPlaylistUi();
    if (options?.playAfterLoad && !state.isRunning) {
      togglePlayback(context);
    }
    return true;
  }

  function renderPlaylistModal() {
    elements.playlistList.innerHTML = "";
    if (state.playlist.tracks.length === 0) {
      elements.playlistList.textContent = "No playlist yet.";
      elements.playlistClearButton.disabled = true;
      return;
    }
    elements.playlistClearButton.disabled = false;
    const list = document.createElement("ol");
    list.className = "playlist-list";
    state.playlist.tracks.forEach((track, index) => {
      const isCurrent = index === state.playlist.currentIndex;
      const item = document.createElement("li");
      item.className = "playlist-item";
      item.classList.toggle("is-current", isCurrent);
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "playlist-select";
      selectButton.dataset.playlistIndex = String(index);
      selectButton.disabled = isCurrent;
      selectButton.addEventListener("click", handlePlaylistItemClick);
      const title = document.createElement("span");
      title.className = "playlist-item-title";
      title.textContent = track.title || "Untitled";
      const artist = document.createElement("span");
      artist.className = "playlist-item-artist";
      artist.textContent = track.artist || "";
      selectButton.append(title, artist);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "playlist-remove";
      removeButton.dataset.playlistIndex = String(index);
      removeButton.disabled = isCurrent;
      removeButton.setAttribute("aria-label", `Remove ${track.title || "track"}`);
      removeButton.innerHTML =
        '<span class="material-symbols-outlined playlist-remove-icon" aria-hidden="true">close</span>';
      removeButton.addEventListener("click", handlePlaylistRemoveClick);
      item.append(selectButton, removeButton);
      list.append(item);
    });
    elements.playlistList.append(list);
  }

  function handlePlaylistItemClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const index = Number(button?.dataset.playlistIndex);
    if (!Number.isInteger(index)) {
      return;
    }
    if (
      index === state.playlist.currentIndex ||
      !state.playlist.tracks[index] ||
      isPlaylistLoadBlocked()
    ) {
      syncPlaylistUi();
      return;
    }
    void loadPlaylistIndex(index, { closeModal: true });
  }

  function handlePlaylistRemoveClick(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget as HTMLButtonElement | null;
    const index = Number(button?.dataset.playlistIndex);
    if (!Number.isInteger(index)) {
      return;
    }
    updatePlaylist(removePlaylistTrack(state.playlist, index));
  }

  function syncPlaylistUi() {
    const hasTracks = hasPlaylistControls(state.playlist);
    const active = hasActivePlaylistControls(state.playlist);
    const busy = isPlaylistLoadBlocked();
    if (typeof document !== "undefined") {
      document.body.classList.toggle("playlist-add-enabled", hasLoadedTrack());
    }
    elements.playlistButton.classList.toggle("is-hidden", !hasTracks);
    elements.playlistPreviousButton.classList.toggle("is-hidden", !active);
    elements.playlistNextButton.classList.toggle("is-hidden", !active);
    elements.playlistPreviousButton.disabled =
      busy || !canMovePlaylistPrevious(state.playlist);
    elements.playlistNextButton.disabled =
      busy || !canMovePlaylistNext(state.playlist);
    elements.playlistButton.title = active
      ? `Playlist (${state.playlist.currentIndex + 1}/${state.playlist.tracks.length})`
      : "Saved Playlist";
    elements.playlistButton.setAttribute("aria-label", elements.playlistButton.title);
    elements.savedPlaylistButton.classList.toggle(
      "hidden",
      !shouldShowSavedPlaylistButton(),
    );
    if (elements.playlistModal.classList.contains("open")) {
      renderPlaylistModal();
    }
  }

  function updatePlaylist(nextPlaylist: AppState["playlist"]) {
    state.playlist = nextPlaylist;
    savePlaylist(nextPlaylist);
    syncPlaylistUi();
  }

  function shouldShowSavedPlaylistButton() {
    return (
      hasInactiveSavedPlaylist(state.playlist) &&
      !state.audioLoaded &&
      !state.analysisLoaded &&
      !state.audioLoadInFlight &&
      !state.lastTrackId &&
      !state.lastJobId
    );
  }

  function hasLoadedTrack() {
    return (
      Boolean(state.lastTrackId ?? state.lastJobId) &&
      state.audioLoaded &&
      state.analysisLoaded
    );
  }

  function isPlaylistLoadBlocked() {
    return (
      state.audioLoadInFlight ||
      state.pollController !== null ||
      playlistLoadInFlight ||
      state.swingPreparing
    );
  }

  function applyTrackTuning(track: PlaylistTrack) {
    state.tuningParams = state.playMode === "jukebox"
      ? (track.tuningParams ?? null)
      : null;
    writeTuningParamsToUrl(state.tuningParams, true);
  }

  function getCurrentTuningParams() {
    if (state.playMode !== "jukebox") {
      return null;
    }
    if (!context.engine || !context.defaultConfig) {
      return state.tuningParams;
    }
    return syncTuningParamsState(context);
  }

  function getPlaylistListenId(track: PlaylistTrack) {
    if (isLikelyJobId(track.id)) {
      return track.id;
    }
    if (track.sourceType === "youtube" || track.sourceType === "upload") {
      return track.id;
    }
    return `${track.sourceType}:${track.id}`;
  }

  function getPlaylistLoadId(track: PlaylistTrack) {
    if (isLikelyJobId(track.id)) {
      return track.id;
    }
    if (track.sourceType === "youtube") {
      return track.id;
    }
    return `${track.sourceType}:${track.id}`;
  }

  return {
    handleNormalTrackSelected,
    handleAddToPlaylist,
    handleOpenPlaylist,
    handleClosePlaylist,
    handlePlaylistModalClick,
    handlePlaylistModalKeydown,
    handleClearPlaylist,
    handleSavedPlaylistClick,
    handlePlaylistPrevious,
    handlePlaylistNext,
    advanceAutocanonizerOnEnded,
    loadPlaylistIndex,
    syncPlaylistUi,
  };
}
