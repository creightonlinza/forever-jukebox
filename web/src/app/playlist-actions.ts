import type { AppState } from "./context";
import type { FavoriteTrack } from "./favorites";
import { isLikelyJobId } from "./identity";
import { loadTrackById, loadTrackByJobId, togglePlayback } from "./playback";
import { setPlayMode } from "./playback-ui";
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
} from "./playlist";
import { getAppContext, getPlaybackDeps } from "./runtime";
import { useAppStore } from "./store";
import { syncTuningParamsState, writeTuningParamsToUrl } from "./tuning";
import { showToast } from "./ui";
import i18n from "./i18n";

let playlistLoadInFlight = false;

export function playlistPrevious(): void {
  handlePlaylistPrevious();
}

export function playlistNext(): void {
  handlePlaylistNext();
}

export function selectPlaylistIndex(index: number): void {
  selectPlaylistIndexInternal(index);
}

export function removePlaylistIndex(index: number): void {
  removePlaylistIndexInternal(index);
}

export function clearPlaylist(): void {
  handleClearPlaylist();
}

export function addToPlaylist(track: PlaylistTrack): void {
  handleAddToPlaylist(track);
}

export function resetPlaylistActionsForTest(): void {
  playlistLoadInFlight = false;
}

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
      title: useAppStore.getState().trackTitle || i18n.t("common.untitled"),
      artist: useAppStore.getState().trackArtist || "",
      duration: useAppStore.getState().trackDurationSec,
      tuningParams,
      playMode: useAppStore.getState().playMode,
    };
  }

  function getCurrentPlaylistTrackId() {
    const rawId = useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId;
    if (!rawId) {
      return null;
    }
    const { lastSourceProvider: provider, lastTrackId } =
      useAppStore.getState();
    if ((provider === "soundcloud" || provider === "bandcamp") && lastTrackId) {
      const prefix = `${provider}:`;
      return lastTrackId.startsWith(prefix)
        ? lastTrackId.slice(prefix.length)
        : lastTrackId;
    }
    if (provider === "upload") {
      return useAppStore.getState().lastJobId ?? rawId;
    }
    return rawId;
  }

  function getCurrentPlaylistSourceType(): PlaylistTrack["sourceType"] {
    const provider = useAppStore.getState().lastSourceProvider;
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

export function handleNormalTrackSelected(track: PlaylistTrack) {
    if (isPlaylistActive(useAppStore.getState().playlist)) {
      updatePlaylist(replaceActivePlaylistTrack(useAppStore.getState().playlist, track));
      return;
    }
    if (hasInactiveSavedPlaylist(useAppStore.getState().playlist)) {
      updatePlaylist(emptyPlaylist());
    }
  }

  function handleAddToPlaylist(track: PlaylistTrack) {
    const result = addPlaylistTrack(
      useAppStore.getState().playlist,
      getCurrentPlaylistTrack(),
      track,
    );
    if (result.status === "duplicate") {
      showToast(i18n.t("playlist.alreadyAdded"));
      return;
    }
    if (result.status === "full") {
      showToast(i18n.t("playlist.full"));
      return;
    }
    if (result.status === "invalid") {
      showToast(i18n.t("playlist.cannotAdd"));
      return;
    }
    updatePlaylist(result.playlist);
    showToast(i18n.t("playlist.added"), { icon: "playlist_add_check" });
  }

  function handleClosePlaylist() {
    useAppStore.setState({ playlistModalOpen: false });
  }

  function handleClearPlaylist() {
    updatePlaylist(emptyPlaylist());
    handleClosePlaylist();
  }

  function handlePlaylistPrevious() {
    if (!canMovePlaylistPrevious(useAppStore.getState().playlist) || isPlaylistLoadBlocked()) {
      return;
    }
    void loadPlaylistIndex(useAppStore.getState().playlist.currentIndex - 1, {
      playAfterLoad: useAppStore.getState().isRunning,
    });
  }

  function handlePlaylistNext() {
    if (!canMovePlaylistNext(useAppStore.getState().playlist) || isPlaylistLoadBlocked()) {
      return;
    }
    void loadPlaylistIndex(useAppStore.getState().playlist.currentIndex + 1, {
      playAfterLoad: useAppStore.getState().isRunning,
    });
  }

export async function advanceAutocanonizerOnEnded() {
    if (!canMovePlaylistNext(useAppStore.getState().playlist) || isPlaylistLoadBlocked()) {
      return false;
    }
    return await loadPlaylistIndex(useAppStore.getState().playlist.currentIndex + 1, {
      playAfterLoad: true,
    });
  }

export async function loadPlaylistIndex(
    index: number,
    options?: { playAfterLoad?: boolean; closeModal?: boolean },
  ): Promise<boolean> {
    const track = useAppStore.getState().playlist.tracks[index];
    if (index === useAppStore.getState().playlist.currentIndex || !track || isPlaylistLoadBlocked()) {
      return false;
    }
    const deps = getPlaybackDeps();
    if (!deps) {
      return false;
    }
    const context = getAppContext();
    if (options?.closeModal) {
      handleClosePlaylist();
    }
    const previousPlaylist = syncActivePlaylistTrackTuning();
    playlistLoadInFlight = true;
    useAppStore.setState({ playlistLoadBusy: true });
    const activatedPlaylist = activatePlaylistTrack(
      useAppStore.getState().playlist,
      index,
    );
    updatePlaylist(activatedPlaylist);
    // Switch mode first so applyTrackTuning sees the right mode and the URL
    // navigation below serializes it. Tracks without a stored mode default to
    // jukebox.
    setPlayMode(track.playMode ?? "jukebox");
    applyTrackTuning(track);
    useAppStore
      .getState()
      .navigateToTabWithState("play", { trackId: getPlaylistListenId(track) });
    let loadStarted = false;
    try {
      const result =
        track.sourceType === "upload" || isLikelyJobId(track.id)
          ? await loadTrackByJobId(context, deps, track.id, {
              preserveUrlTuning: true,
              playlistLoad: true,
              selectedTrack: track,
            })
          : await loadTrackById(context, deps, getPlaylistLoadId(track), {
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
      // Only roll back if no newer load has replaced the playlist meanwhile.
      if (useAppStore.getState().playlist === activatedPlaylist) {
        updatePlaylist(previousPlaylist);
      }
      return false;
    }
    if (options?.playAfterLoad && !useAppStore.getState().isRunning) {
      togglePlayback(context);
    }
    return true;
  }



  function updatePlaylist(nextPlaylist: AppState["playlist"]) {
    useAppStore.setState({ playlist: nextPlaylist });
    savePlaylist(nextPlaylist);
  }

  function syncActivePlaylistTrackTuning(): AppState["playlist"] {
    const playlist = useAppStore.getState().playlist ?? emptyPlaylist();
    useAppStore.setState({ playlist });
    if (!isPlaylistActive(playlist)) {
      return playlist;
    }
    const track = playlist.tracks[playlist.currentIndex];
    if (!track) {
      return playlist;
    }
    const playMode = useAppStore.getState().playMode;
    const tuningParams = playMode === "jukebox" ? getCurrentTuningParams() : null;
    const favorite = findFavoriteForPlaylistTrack(track);
    if (favorite) {
      const favoritePlayMode = favorite.playMode ?? "jukebox";
      const favoriteTuningParams =
        favoritePlayMode === "jukebox"
          ? normalizeStoredTuningParams(favorite.tuningParams)
          : null;
      if (
        playMode !== favoritePlayMode ||
        tuningParams !== favoriteTuningParams
      ) {
        updatePlaylist(
          replaceActivePlaylistTrack(playlist, {
            ...track,
            tuningParams: favoriteTuningParams,
            playMode: favorite.playMode,
          }),
        );
        return useAppStore.getState().playlist;
      }
    }
    updatePlaylist(
      replaceActivePlaylistTrack(playlist, {
        ...track,
        tuningParams,
        playMode,
      }),
    );
    return useAppStore.getState().playlist;
  }

  function findFavoriteForPlaylistTrack(track: PlaylistTrack): FavoriteTrack | null {
    return (
      useAppStore
        .getState()
        .favorites.find(
          (favorite) =>
            favorite.uniqueSongId === track.id &&
            favorite.sourceType === track.sourceType,
        ) ?? null
    );
  }

  function normalizeStoredTuningParams(tuningParams: string | null | undefined) {
    return typeof tuningParams === "string" && tuningParams.trim()
      ? tuningParams
      : null;
  }





  function isPlaylistLoadBlocked() {
    return (
      useAppStore.getState().audioLoadInFlight ||
      useAppStore.getState().analysisPollInFlight ||
      playlistLoadInFlight ||
      useAppStore.getState().swingPreparing
    );
  }

  function applyTrackTuning(track: PlaylistTrack) {
    useAppStore.setState({
      tuningParams: useAppStore.getState().playMode === "jukebox"
      ? (track.tuningParams ?? null)
      : null
    });
    writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
  }

  function getCurrentTuningParams() {
    if (useAppStore.getState().playMode !== "jukebox") {
      return null;
    }
    const context = getAppContext();
    if (!context.engine || !context.defaultConfig) {
      return useAppStore.getState().tuningParams;
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

  function removePlaylistIndexInternal(index: number) {
    if (!Number.isInteger(index)) {
      return;
    }
    updatePlaylist(removePlaylistTrack(useAppStore.getState().playlist, index));
  }

  function selectPlaylistIndexInternal(index: number) {
    if (!Number.isInteger(index)) {
      return;
    }
    if (
      index === useAppStore.getState().playlist.currentIndex ||
      !useAppStore.getState().playlist.tracks[index] ||
      isPlaylistLoadBlocked()
    ) {
      return;
    }
    void loadPlaylistIndex(index, { closeModal: true });
  }
