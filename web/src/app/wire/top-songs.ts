import type { Elements } from "../elements";
import type { TabId } from "../context";
import { formatErrorForDisplay } from "../errorDisplay";
import { isLikelyJobId } from "../identity";
import type { PlaylistTrack } from "../playlist";
import { blurMouseActivatedControl } from "../ui";
type TopSongsDeps = {
  elements: Elements;
  fetchTopSongs: (limit: number) => Promise<
    Array<{ id?: string; title?: string; artist?: string; source_id?: string; source_provider?: string }>
  >;
  fetchTrendingSongs: () => Promise<
    Array<{ id?: string; title?: string; artist?: string; source_id?: string; source_provider?: string }>
  >;
  fetchRecentSongs: (limit: number) => Promise<
    Array<{ id?: string; title?: string; artist?: string; source_id?: string; source_provider?: string }>
  >;
  loadTrackById: (
    trackId: string,
    options?: { selectedTrack?: PlaylistTrack | null },
  ) => void;
  loadTrackByJobId: (
    jobId: string,
    options?: { selectedTrack?: PlaylistTrack | null },
  ) => void;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  limit: number;
  onAddToPlaylist?: (track: PlaylistTrack) => void;
};

export type TopSongsHandlers = ReturnType<typeof createTopSongsHandlers>;

export function createTopSongsHandlers(deps: TopSongsDeps) {
  const {
    elements,
    fetchTopSongs,
    fetchTrendingSongs,
    fetchRecentSongs,
    loadTrackById,
    loadTrackByJobId,
    navigateToTabWithState,
    limit,
    onAddToPlaylist,
  } = deps;

  async function renderSongList(options: {
    listEl: HTMLOListElement;
    fetchItems: () => Promise<
      Array<{ id?: string; title?: string; artist?: string; source_id?: string; source_provider?: string }>
    >;
    loadingText: string;
    emptyText: string;
    errorPrefix: string;
  }) {
    const { listEl, fetchItems, loadingText, emptyText, errorPrefix } = options;
    listEl.textContent = loadingText;
    try {
      const items = await fetchItems();
      if (items.length === 0) {
        listEl.textContent = emptyText;
        return;
      }
      listEl.innerHTML = "";
      for (const item of items.slice(0, limit)) {
        const title = typeof item.title === "string" ? item.title : "Untitled";
        const artist = typeof item.artist === "string" ? item.artist : "";
        const jobId = typeof item.id === "string" ? item.id : "";
        const sourceProvider =
          typeof item.source_provider === "string" ? item.source_provider : "";
        const sourceType = normalizePlaylistSourceType(sourceProvider);
        const listenId = jobId;
        const li = document.createElement("li");
        if (listenId) {
          li.className = "top-list-item";
          const link = document.createElement("a");
          link.href = `/listen/${encodeURIComponent(listenId)}`;
          link.textContent = artist ? `${title} — ${artist}` : title;
          link.dataset.trackId = listenId;
          link.dataset.playlistId = getPlaylistTrackId(
            jobId,
            listenId,
          );
          link.dataset.sourceType = sourceType;
          link.dataset.trackTitle = title;
          link.dataset.trackArtist = artist;
          link.addEventListener("click", handleTopSongClick);
          const addButton = createPlaylistAddButton({
            id: link.dataset.playlistId,
            sourceType,
            title,
            artist,
            duration: null,
          });
          li.appendChild(link);
          if (addButton) {
            li.appendChild(addButton);
          }
        } else {
          li.textContent = artist ? `${title} — ${artist}` : title;
        }
        listEl.appendChild(li);
      }
    } catch (err) {
      listEl.textContent =
        `${errorPrefix} unavailable: ${formatErrorForDisplay(err)}`;
    }
  }

  function fetchTopSongsList() {
    return renderSongList({
      listEl: elements.topSongsList,
      fetchItems: () => fetchTopSongs(limit),
      loadingText: "Loading top tracks…",
      emptyText: "No plays recorded yet.",
      errorPrefix: "Top tracks",
    });
  }

  function fetchRecentSongsList() {
    return renderSongList({
      listEl: elements.recentSongsList,
      fetchItems: () => fetchRecentSongs(limit),
      loadingText: "Loading recent plays…",
      emptyText: "No recent plays yet.",
      errorPrefix: "Recent plays",
    });
  }

  function fetchTrendingSongsList() {
    return renderSongList({
      listEl: elements.trendingSongsList,
      fetchItems: () => fetchTrendingSongs(),
      loadingText: "Loading trending tracks…",
      emptyText: "No trending tracks yet.",
      errorPrefix: "Trending tracks",
    });
  }


  function handleTopSongClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const trackId = target?.dataset.trackId;
    if (!trackId) {
      return;
    }
    const selectedTrack = getPlaylistTrackFromDataset(target);
    navigateToTabWithState("play", { trackId });
    if (isLikelyJobId(trackId)) {
      loadTrackByJobId(trackId, { selectedTrack });
      return;
    }
    loadTrackById(trackId, { selectedTrack });
  }

  function getPlaylistTrackFromDataset(target: HTMLElement): PlaylistTrack | null {
    const id = target.dataset.playlistId;
    const sourceType = normalizePlaylistSourceType(target.dataset.sourceType ?? "");
    if (!id) {
      return null;
    }
    return {
      id,
      sourceType,
      title: target.dataset.trackTitle || "Untitled",
      artist: target.dataset.trackArtist || "",
      duration: null,
    };
  }

  function createPlaylistAddButton(track: PlaylistTrack) {
    if (!onAddToPlaylist || !track.id) {
      return null;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playlist-add-button";
    button.title = "Add to playlist";
    button.setAttribute("aria-label", `Add ${track.title || "track"} to playlist`);
    button.innerHTML =
      '<span class="material-symbols-outlined playlist-add-icon" aria-hidden="true">add_circle</span>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onAddToPlaylist(track);
      blurMouseActivatedControl(event);
    });
    return button;
  }

  function normalizePlaylistSourceType(value: string): PlaylistTrack["sourceType"] {
    if (value === "soundcloud" || value === "bandcamp" || value === "upload") {
      return value;
    }
    return "youtube";
  }

  function getPlaylistTrackId(jobId: string, listenId: string) {
    return jobId || listenId;
  }

  return { fetchTopSongsList, fetchTrendingSongsList, fetchRecentSongsList };
}
