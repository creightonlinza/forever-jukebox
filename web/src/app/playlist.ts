export type PlaylistSourceType = "youtube" | "soundcloud" | "bandcamp" | "upload";

export type PlaylistTrack = {
  id: string;
  sourceType: PlaylistSourceType;
  title: string;
  artist: string;
  duration: number | null;
  tuningParams?: string | null;
};

export type PlaylistState = {
  tracks: PlaylistTrack[];
  currentIndex: number;
};

export type PlaylistAddStatus =
  | "added"
  | "duplicate"
  | "full"
  | "no-current";

export const PLAYLIST_STORAGE_KEY = "fj-playlist";
export const PLAYLIST_MAX_TRACKS = 10;

export function emptyPlaylist(): PlaylistState {
  return { tracks: [], currentIndex: -1 };
}

export function playlistTrackKey(track: Pick<PlaylistTrack, "id" | "sourceType">) {
  return `${track.sourceType}:${track.id.trim()}`;
}

export function isPlaylistActive(playlist: PlaylistState) {
  return (
    playlist.currentIndex >= 0 &&
    playlist.currentIndex < playlist.tracks.length
  );
}

export function hasInactiveSavedPlaylist(playlist: PlaylistState) {
  return playlist.tracks.length >= 2 && !isPlaylistActive(playlist);
}

export function hasPlaylistControls(playlist: PlaylistState) {
  return playlist.tracks.length > 1;
}

export function hasActivePlaylistControls(playlist: PlaylistState) {
  return hasPlaylistControls(playlist) && isPlaylistActive(playlist);
}

export function canMovePlaylistPrevious(playlist: PlaylistState) {
  return hasActivePlaylistControls(playlist) && playlist.currentIndex > 0;
}

export function canMovePlaylistNext(playlist: PlaylistState) {
  return (
    hasActivePlaylistControls(playlist) &&
    playlist.currentIndex < playlist.tracks.length - 1
  );
}

export function normalizePlaylistTrack(track: PlaylistTrack): PlaylistTrack | null {
  const id = typeof track.id === "string" ? track.id.trim() : "";
  if (!id || !isPlaylistSourceType(track.sourceType)) {
    return null;
  }
  const title =
    typeof track.title === "string" && track.title.trim()
      ? track.title.trim()
      : "Untitled";
  const artist = typeof track.artist === "string" ? track.artist.trim() : "";
  const duration =
    typeof track.duration === "number" && Number.isFinite(track.duration)
      ? track.duration
      : null;
  const tuningParams =
    typeof track.tuningParams === "string" && track.tuningParams.trim()
      ? track.tuningParams
      : null;
  const normalized: PlaylistTrack = {
    id,
    sourceType: track.sourceType,
    title,
    artist,
    duration,
  };
  if (tuningParams) {
    normalized.tuningParams = tuningParams;
  }
  return normalized;
}

export function addPlaylistTrack(
  playlist: PlaylistState,
  currentTrack: PlaylistTrack | null,
  track: PlaylistTrack,
): { playlist: PlaylistState; status: PlaylistAddStatus } {
  const normalizedTrack = normalizePlaylistTrack(track);
  const normalizedCurrent = currentTrack
    ? normalizePlaylistTrack(currentTrack)
    : null;
  if (!normalizedTrack) {
    return { playlist, status: "duplicate" };
  }
  const existingTracks = playlist.tracks;
  const existingKeys = new Set(existingTracks.map(playlistTrackKey));
  if (existingKeys.has(playlistTrackKey(normalizedTrack))) {
    return { playlist, status: "duplicate" };
  }
  if (existingTracks.length === 0) {
    if (!normalizedCurrent) {
      return { playlist, status: "no-current" };
    }
    if (playlistTrackKey(normalizedCurrent) === playlistTrackKey(normalizedTrack)) {
      return { playlist, status: "duplicate" };
    }
    return {
      playlist: {
        tracks: [normalizedCurrent, normalizedTrack],
        currentIndex: 0,
      },
      status: "added",
    };
  }
  if (existingTracks.length >= PLAYLIST_MAX_TRACKS) {
    return { playlist, status: "full" };
  }
  return {
    playlist: {
      tracks: [...existingTracks, normalizedTrack],
      currentIndex: playlist.currentIndex,
    },
    status: "added",
  };
}

export function activatePlaylistTrack(
  playlist: PlaylistState,
  index: number,
): PlaylistState {
  if (index < 0 || index >= playlist.tracks.length) {
    return playlist;
  }
  return { ...playlist, currentIndex: index };
}

export function replaceActivePlaylistTrack(
  playlist: PlaylistState,
  track: PlaylistTrack,
): PlaylistState {
  if (!isPlaylistActive(playlist)) {
    return emptyPlaylist();
  }
  const normalized = normalizePlaylistTrack(track);
  if (!normalized) {
    return playlist;
  }
  const currentIndex = playlist.currentIndex;
  const nextTracks = playlist.tracks.slice();
  nextTracks[currentIndex] = normalized;
  const replacementKey = playlistTrackKey(normalized);
  const duplicateIndex = nextTracks.findIndex(
    (candidate, index) =>
      index !== currentIndex && playlistTrackKey(candidate) === replacementKey,
  );
  let nextCurrentIndex = currentIndex;
  if (duplicateIndex >= 0) {
    nextTracks.splice(duplicateIndex, 1);
    if (duplicateIndex < nextCurrentIndex) {
      nextCurrentIndex -= 1;
    }
  }
  if (nextTracks.length < 2) {
    return emptyPlaylist();
  }
  return { tracks: nextTracks, currentIndex: nextCurrentIndex };
}

export function removePlaylistTrack(
  playlist: PlaylistState,
  index: number,
): PlaylistState {
  if (index < 0 || index >= playlist.tracks.length) {
    return playlist;
  }
  if (index === playlist.currentIndex) {
    return playlist;
  }
  const nextTracks = playlist.tracks.filter((_, itemIndex) => itemIndex !== index);
  if (nextTracks.length < 2) {
    return emptyPlaylist();
  }
  const nextCurrentIndex =
    playlist.currentIndex > index
      ? playlist.currentIndex - 1
      : playlist.currentIndex;
  return { tracks: nextTracks, currentIndex: nextCurrentIndex };
}

export function loadPlaylist(): PlaylistState {
  const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!raw) {
    return emptyPlaylist();
  }
  try {
    const parsed = JSON.parse(raw) as { tracks?: PlaylistTrack[] };
    const rawTracks = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.tracks)
        ? parsed.tracks
        : [];
    const tracks = normalizePlaylistTracks(rawTracks).slice(0, PLAYLIST_MAX_TRACKS);
    if (tracks.length < 2) {
      localStorage.removeItem(PLAYLIST_STORAGE_KEY);
      return emptyPlaylist();
    }
    return { tracks, currentIndex: -1 };
  } catch {
    return emptyPlaylist();
  }
}

export function savePlaylist(playlist: PlaylistState) {
  if (playlist.tracks.length < 2) {
    localStorage.removeItem(PLAYLIST_STORAGE_KEY);
    return;
  }
  localStorage.setItem(
    PLAYLIST_STORAGE_KEY,
    JSON.stringify({ tracks: playlist.tracks.slice(0, PLAYLIST_MAX_TRACKS) }),
  );
}

function normalizePlaylistTracks(tracks: PlaylistTrack[]) {
  const seen = new Set<string>();
  const normalized: PlaylistTrack[] = [];
  for (const track of tracks) {
    const item = normalizePlaylistTrack(track);
    if (!item) {
      continue;
    }
    const key = playlistTrackKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

function isPlaylistSourceType(value: unknown): value is PlaylistSourceType {
  return (
    value === "youtube" ||
    value === "soundcloud" ||
    value === "bandcamp" ||
    value === "upload"
  );
}
