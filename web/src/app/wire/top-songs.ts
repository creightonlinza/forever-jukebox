import type { Elements } from "../elements";
import type { TabId } from "../context";
type TopSongsDeps = {
  elements: Elements;
  fetchTopSongs: (limit: number) => Promise<
    Array<{ title?: string; artist?: string; youtube_id?: string }>
  >;
  fetchTrendingSongs: () => Promise<
    Array<{ title?: string; artist?: string; youtube_id?: string }>
  >;
  fetchRecentSongs: (limit: number) => Promise<
    Array<{ title?: string; artist?: string; youtube_id?: string }>
  >;
  loadTrackByYouTubeId: (youtubeId: string) => void;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; youtubeId?: string | null },
  ) => void;
  limit: number;
};

export type TopSongsHandlers = ReturnType<typeof createTopSongsHandlers>;

export function createTopSongsHandlers(deps: TopSongsDeps) {
  const {
    elements,
    fetchTopSongs,
    fetchTrendingSongs,
    fetchRecentSongs,
    loadTrackByYouTubeId,
    navigateToTabWithState,
    limit,
  } = deps;

  async function renderSongList(options: {
    listEl: HTMLOListElement;
    fetchItems: () => Promise<
      Array<{ title?: string; artist?: string; youtube_id?: string }>
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
        const youtubeId =
          typeof item.youtube_id === "string" ? item.youtube_id : "";
        const li = document.createElement("li");
        if (youtubeId) {
          const link = document.createElement("a");
          link.href = `/listen/${encodeURIComponent(youtubeId)}`;
          link.textContent = artist ? `${title} — ${artist}` : title;
          link.dataset.youtubeId = youtubeId;
          link.addEventListener("click", handleTopSongClick);
          li.appendChild(link);
        } else {
          li.textContent = artist ? `${title} — ${artist}` : title;
        }
        listEl.appendChild(li);
      }
    } catch (err) {
      listEl.textContent = `${errorPrefix} unavailable: ${String(err)}`;
    }
  }

  function fetchTopSongsList() {
    return renderSongList({
      listEl: elements.topSongsList,
      fetchItems: () => fetchTopSongs(limit),
      loadingText: "Loading top songs…",
      emptyText: "No plays recorded yet.",
      errorPrefix: "Top songs",
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
      loadingText: "Loading trending songs…",
      emptyText: "No trending songs yet.",
      errorPrefix: "Trending songs",
    });
  }


  function handleTopSongClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const youtubeId = target?.dataset.youtubeId;
    if (!youtubeId) {
      return;
    }
    navigateToTabWithState("play", { youtubeId });
    loadTrackByYouTubeId(youtubeId);
  }

  return { fetchTopSongsList, fetchTrendingSongsList, fetchRecentSongsList };
}
