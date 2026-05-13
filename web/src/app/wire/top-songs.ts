import type { Elements } from "../elements";
import type { TabId } from "../context";
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
  loadTrackById: (trackId: string) => void;
  loadTrackByJobId: (jobId: string) => void;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
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
    loadTrackById,
    loadTrackByJobId,
    navigateToTabWithState,
    limit,
  } = deps;

  function isLikelyJobId(value: string) {
    return /^[a-f0-9]{32}$/.test(value);
  }

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
        const sourceId =
          typeof item.source_id === "string" ? item.source_id : "";
        const jobId = typeof item.id === "string" ? item.id : "";
        const sourceProvider =
          typeof item.source_provider === "string" ? item.source_provider : "";
        const listenId =
          sourceProvider === "youtube" && sourceId
            ? sourceId
            : jobId;
        const li = document.createElement("li");
        if (listenId) {
          const link = document.createElement("a");
          link.href = `/listen/${encodeURIComponent(listenId)}`;
          link.textContent = artist ? `${title} — ${artist}` : title;
          link.dataset.trackId = listenId;
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
    const trackId = target?.dataset.trackId;
    if (!trackId) {
      return;
    }
    navigateToTabWithState("play", { trackId });
    if (isLikelyJobId(trackId)) {
      loadTrackByJobId(trackId);
      return;
    }
    loadTrackById(trackId);
  }

  return { fetchTopSongsList, fetchTrendingSongsList, fetchRecentSongsList };
}
