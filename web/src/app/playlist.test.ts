import { beforeEach, describe, expect, it } from "vitest";
import {
  PLAYLIST_MAX_TRACKS,
  PLAYLIST_STORAGE_KEY,
  activatePlaylistTrack,
  addPlaylistTrack,
  canMovePlaylistNext,
  canMovePlaylistPrevious,
  emptyPlaylist,
  hasInactiveSavedPlaylist,
  loadPlaylist,
  playlistTrackKey,
  removePlaylistTrack,
  replaceActivePlaylistTrack,
  savePlaylist,
  type PlaylistTrack,
} from "./playlist";

function setLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
  return store;
}

function track(
  id: string,
  sourceType: PlaylistTrack["sourceType"] = "youtube",
): PlaylistTrack {
  return {
    id,
    sourceType,
    title: `Track ${id}`,
    artist: "Artist",
    duration: null,
  };
}

describe("playlist", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  it("uses source type and trimmed id for duplicate keys", () => {
    expect(playlistTrackKey(track(" abc "))).toBe("youtube:abc");
    expect(playlistTrackKey(track("abc", "upload"))).toBe("upload:abc");
  });

  it("initializes from the current track and added track", () => {
    const result = addPlaylistTrack(emptyPlaylist(), track("current"), track("next"));

    expect(result.status).toBe("added");
    expect(result.playlist.currentIndex).toBe(0);
    expect(result.playlist.tracks.map((item) => item.id)).toEqual([
      "current",
      "next",
    ]);
  });

  it("treats a missing current track as invalid (unreachable via UI)", () => {
    const result = addPlaylistTrack(emptyPlaylist(), null, track("next"));

    expect(result.status).toBe("invalid");
    expect(result.playlist.tracks).toEqual([]);
  });

  it("rejects invalid tracks separately from duplicates", () => {
    const result = addPlaylistTrack(emptyPlaylist(), track("current"), track(""));

    expect(result.status).toBe("invalid");
    expect(result.playlist.tracks).toEqual([]);
  });

  it("blocks duplicates and max size", () => {
    let playlist = {
      tracks: [track("0"), track("1")],
      currentIndex: 0,
    };
    const duplicate = addPlaylistTrack(playlist, track("0"), track(" 1 "));
    expect(duplicate.status).toBe("duplicate");

    playlist = {
      tracks: Array.from({ length: PLAYLIST_MAX_TRACKS }, (_, index) =>
        track(`${index}`),
      ),
      currentIndex: 0,
    };
    const full = addPlaylistTrack(playlist, track("0"), track("extra"));
    expect(full.status).toBe("full");
  });

  it("activates tracks and reports adjacent availability", () => {
    let playlist = {
      tracks: [track("0"), track("1"), track("2")],
      currentIndex: -1,
    };
    expect(hasInactiveSavedPlaylist(playlist)).toBe(true);

    playlist = activatePlaylistTrack(playlist, 1);
    expect(playlist.currentIndex).toBe(1);
    expect(canMovePlaylistPrevious(playlist)).toBe(true);
    expect(canMovePlaylistNext(playlist)).toBe(true);

    playlist = activatePlaylistTrack(playlist, 2);
    expect(canMovePlaylistNext(playlist)).toBe(false);
  });

  it("replaces the active track and removes an older duplicate", () => {
    const playlist = {
      tracks: [track("a"), track("b"), track("c")],
      currentIndex: 1,
    };
    const next = replaceActivePlaylistTrack(playlist, track("a"));

    expect(next.currentIndex).toBe(0);
    expect(next.tracks.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("removes non-current tracks and adjusts current index", () => {
    const playlist = {
      tracks: [track("a"), track("b"), track("c")],
      currentIndex: 2,
    };
    const next = removePlaylistTrack(playlist, 0);

    expect(next.currentIndex).toBe(1);
    expect(next.tracks.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("does not remove current track and clears when fewer than two remain", () => {
    const playlist = {
      tracks: [track("a"), track("b")],
      currentIndex: 0,
    };

    expect(removePlaylistTrack(playlist, 0)).toBe(playlist);
    expect(removePlaylistTrack(playlist, 1)).toEqual(emptyPlaylist());
  });

  it("saves, restores as inactive, and ignores malformed payloads", () => {
    const playlist = {
      tracks: [track("a"), track("b")],
      currentIndex: 1,
    };

    savePlaylist(playlist);
    expect(loadPlaylist()).toEqual({
      tracks: playlist.tracks,
      currentIndex: -1,
    });

    localStorage.setItem(PLAYLIST_STORAGE_KEY, "{nope");
    expect(loadPlaylist()).toEqual(emptyPlaylist());
  });

  it("clears saved playlists with fewer than two valid tracks", () => {
    const store = setLocalStorage();
    localStorage.setItem(
      PLAYLIST_STORAGE_KEY,
      JSON.stringify({ tracks: [track("a")] }),
    );

    expect(loadPlaylist()).toEqual(emptyPlaylist());
    expect(store.has(PLAYLIST_STORAGE_KEY)).toBe(false);
  });
});
