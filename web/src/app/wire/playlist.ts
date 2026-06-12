import type { AppContext, AppState, TabId } from "../context";
import { isLikelyJobId } from "../identity";
import {
  activatePlaylistTrack,
  addPlaylistTrack,
  canMovePlaylistNext,
  canMovePlaylistPrevious,
  emptyPlaylist,
  hasInactiveSavedPlaylist,
  isPlaylistActive,
  removePlaylistTrack,
  replaceActivePlaylistTrack,
  savePlaylist,
  type PlaylistTrack,
} from "../playlist";
import { useAppStore } from "../store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "../tuning";
import type { ToastOptions } from "../ui";

type PlaylistDeps = {
  context: AppContext;
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

  function handleClosePlaylist() {
    useAppStore.setState({ playlistModalOpen: false });
  }

  function handleClearPlaylist() {
    updatePlaylist(emptyPlaylist());
    handleClosePlaylist();
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
      return false;
    }
    if (options?.closeModal) {
      handleClosePlaylist();
    }
    const previousPlaylist = state.playlist;
    playlistLoadInFlight = true;
    useAppStore.setState({ playlistLoadBusy: true });
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
      useAppStore.setState({ playlistLoadBusy: false });
    }
    if (!loadStarted) {
      updatePlaylist(previousPlaylist);
      return false;
    }
    if (options?.playAfterLoad && !state.isRunning) {
      togglePlayback(context);
    }
    return true;
  }



  function updatePlaylist(nextPlaylist: AppState["playlist"]) {
    state.playlist = nextPlaylist;
    savePlaylist(nextPlaylist);
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

  function removePlaylistIndex(index: number) {
    if (!Number.isInteger(index)) {
      return;
    }
    updatePlaylist(removePlaylistTrack(state.playlist, index));
  }

  function selectPlaylistIndex(index: number) {
    if (!Number.isInteger(index)) {
      return;
    }
    if (
      index === state.playlist.currentIndex ||
      !state.playlist.tracks[index] ||
      isPlaylistLoadBlocked()
    ) {
      return;
    }
    void loadPlaylistIndex(index, { closeModal: true });
  }

  return {
    handleNormalTrackSelected,
    handleAddToPlaylist,
    handleClosePlaylist,
    handleClearPlaylist,
    handlePlaylistPrevious,
    handlePlaylistNext,
    advanceAutocanonizerOnEnded,
    loadPlaylistIndex,
    selectPlaylistIndex,
    removePlaylistIndex,
  };
}
