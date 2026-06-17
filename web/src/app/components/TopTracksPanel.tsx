import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { fetchRecentSongs, fetchTopSongs, fetchTrendingSongs } from "../api";
import { TOP_SONGS_LIMIT } from "../constants";
import { formatErrorForDisplay } from "../errorDisplay";
import {
  favoriteDisplayArtist,
  favoriteToPlaylistTrack,
  filterFavorites,
  maxFavorites,
  sortFavoritesForDisplay,
  type FavoriteTrack,
  type FavoritesDisplaySort,
} from "../favorites";
import type { PlaylistTrack } from "../playlist";
import { Modal, ModalHeader } from "./Modal";
import {
  useAppStore,
  type TopSongsItem,
  type TopSongsListState,
  type TopSongsListTabId,
} from "../store";
import { urlForTrack } from "../tabs";
import { blurMouseActivatedControl } from "../ui";
import {
  createSyncCode,
  enterSyncCode,
  refreshFavoritesFromSync,
  removeFavoriteWithToast,
  selectFavorite,
} from "../favorites-actions";
import { addToPlaylist } from "../playlist-actions";
import { selectTrack } from "../track-select";

type TopSongsTabId = "top" | "trending" | "recent" | "favorites";

const LIST_CONFIG: Record<
  TopSongsListTabId,
  {
    loadingText: string;
    emptyText: string;
    errorPrefix: string;
    listId: string;
    fetchItems: () => Promise<TopSongsItem[]>;
  }
> = {
  top: {
    loadingText: "Loading top tracks…",
    emptyText: "No plays recorded yet.",
    errorPrefix: "Top tracks",
    listId: "top-songs",
    fetchItems: () => fetchTopSongs(TOP_SONGS_LIMIT),
  },
  trending: {
    loadingText: "Loading trending tracks…",
    emptyText: "No trending tracks yet.",
    errorPrefix: "Trending tracks",
    listId: "trending-songs",
    fetchItems: () => fetchTrendingSongs(),
  },
  recent: {
    loadingText: "Loading recent plays…",
    emptyText: "No recent plays yet.",
    errorPrefix: "Recent plays",
    listId: "recent-songs",
    fetchItems: () => fetchRecentSongs(TOP_SONGS_LIMIT),
  },
};

function normalizePlaylistSourceType(value: string): PlaylistTrack["sourceType"] {
  if (value === "soundcloud" || value === "bandcamp" || value === "upload") {
    return value;
  }
  return "youtube";
}

function PlaylistAddButton({
  track,
  onAdd,
}: {
  track: PlaylistTrack;
  onAdd: (track: PlaylistTrack) => void;
}) {
  return (
    <button
      type="button"
      className="playlist-add-button"
      title="Add to playlist"
      aria-label={`Add ${track.title || "track"} to playlist`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onAdd(track);
        blurMouseActivatedControl(event.nativeEvent);
      }}
    >
      <span
        className="material-symbols-outlined playlist-add-icon"
        aria-hidden="true"
      >
        add_circle
      </span>
    </button>
  );
}

function SongList({
  tabId,
  state,
  hidden,
}: {
  tabId: TopSongsListTabId;
  state: TopSongsListState;
  hidden: boolean;
}) {
  const config = LIST_CONFIG[tabId];
  const className = hidden ? "top-list hidden" : "top-list";
  if (state.kind === "message") {
    return (
      <ol className={className} id={config.listId}>
        {state.text}
      </ol>
    );
  }
  return (
    <ol className={className} id={config.listId}>
      {state.items.slice(0, TOP_SONGS_LIMIT).map((item, index) => {
        const title = typeof item.title === "string" ? item.title : "Untitled";
        const artist = typeof item.artist === "string" ? item.artist : "";
        const jobId = typeof item.id === "string" ? item.id : "";
        const sourceProvider =
          typeof item.source_provider === "string" ? item.source_provider : "";
        const sourceType = normalizePlaylistSourceType(sourceProvider);
        const listenId = jobId;
        const label = artist ? `${title} — ${artist}` : title;
        if (!listenId) {
          return <li key={index}>{label}</li>;
        }
        const playlistTrack: PlaylistTrack = {
          id: jobId || listenId,
          sourceType,
          title,
          artist,
          duration: null,
        };
        return (
          <li key={`${listenId}-${index}`} className="top-list-item">
            <a
              href={`/listen/${encodeURIComponent(listenId)}`}
              data-track-id={listenId}
              data-playlist-id={playlistTrack.id}
              data-source-type={sourceType}
              data-track-title={title}
              data-track-artist={artist}
              onClick={(event) => {
                event.preventDefault();
                selectTrack(listenId, playlistTrack);
              }}
            >
              {label}
            </a>
            <PlaylistAddButton track={playlistTrack} onAdd={addToPlaylist} />
          </li>
        );
      })}
    </ol>
  );
}

function FavoritesList({ query }: { query: string }) {
  const favorites = useAppStore((s) => s.favorites);
  const [sort, setSort] = useState<FavoritesDisplaySort>({
    key: "title",
    direction: "asc",
  });

  const handleSortClick = (key: FavoritesDisplaySort["key"]) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const select = (item: FavoriteTrack) => {
    selectFavorite(item.uniqueSongId, item.sourceType ?? "youtube");
  };

  const trimmedQuery = query.trim();
  if (favorites.length === 0) {
    return <>No favorites yet.</>;
  }
  const visibleFavorites = filterFavorites(favorites, trimmedQuery);
  if (visibleFavorites.length === 0) {
    return <>{`No favorites match "${trimmedQuery}".`}</>;
  }

  const sortHeader = (key: FavoritesDisplaySort["key"], label: string) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
        }
      >
        <button
          type="button"
          className="favorites-sort-button"
          data-favorites-sort={key}
          onClick={() => handleSortClick(key)}
        >
          {label}
          {active ? (
            <>
              {" "}
              <span
                className="material-symbols-outlined favorites-sort-icon"
                aria-hidden="true"
              >
                {sort.direction === "asc" ? "arrow_upward" : "arrow_downward"}
              </span>
            </>
          ) : null}
        </button>
      </th>
    );
  };

  return (
    <table className="favorites-table">
      <thead>
        <tr>
          {sortHeader("title", "Title")}
          {sortHeader("artist", "Artist")}
          <th
            scope="col"
            className="favorite-remove-heading"
            aria-label="Remove favorite"
          ></th>
        </tr>
      </thead>
      <tbody>
        {sortFavoritesForDisplay(visibleFavorites, sort).map((item) => {
          const sourceType = item.sourceType ?? "youtube";
          const titleText = item.title || "Untitled";
          const handleRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("a, button")) {
              return;
            }
            select(item);
          };
          const handleRowKeydown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            select(item);
          };
          return (
            <tr
              key={item.uniqueSongId}
              className="favorite-row"
              tabIndex={0}
              data-favorite-id={item.uniqueSongId}
              data-source-type={sourceType}
              onClick={handleRowClick}
              onKeyDown={handleRowKeydown}
            >
              <td className="favorite-title-cell">
                <a
                  href={urlForTrack(
                    item.uniqueSongId,
                    window.location.href,
                    item.tuningParams,
                    item.playMode,
                  )}
                  data-favorite-id={item.uniqueSongId}
                  data-source-type={sourceType}
                  onClick={(event) => {
                    event.preventDefault();
                    select(item);
                  }}
                >
                  {titleText}
                  {item.tuningParams ? (
                    <>
                      {" "}
                      <span
                        className="material-symbols-outlined favorite-tune-icon"
                        aria-hidden="true"
                        title="Custom tuning"
                      >
                        tune
                      </span>
                    </>
                  ) : null}
                </a>
              </td>
              <td className="favorite-artist-cell">
                {favoriteDisplayArtist(item)}
              </td>
              <td className="favorite-remove-cell">
                <PlaylistAddButton
                  track={favoriteToPlaylistTrack(item, sourceType)}
                  onAdd={addToPlaylist}
                />
                <button
                  type="button"
                  className="favorite-remove"
                  aria-label={`Remove ${titleText} from Favorites`}
                  data-favorite-id={item.uniqueSongId}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeFavoriteWithToast(item.uniqueSongId);
                  }}
                >
                  <span
                    className="material-symbols-outlined favorite-remove-icon"
                    aria-hidden="true"
                  >
                    close
                  </span>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FavoritesSyncEnterModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setStatus(null);
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [open]);

  const submit = async () => {
    const code = value.trim();
    if (!code) {
      setStatus({ text: "Enter a sync code first.", error: true });
      return;
    }
    setBusy(true);
    setStatus({ text: "Syncing favorites...", error: false });
    try {
      const result = await enterSyncCode(code);
      if (result === "replaced") {
        setStatus({ text: "Favorites updated.", error: false });
        onClose();
      } else {
        setStatus(null);
      }
    } catch (err) {
      setStatus({ text: "Unable to sync favorites.", error: true });
      console.warn(`Favorites sync failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal id="favorites-sync-enter-modal" open={open} onClose={onClose}>
      <ModalHeader
        title="Favorites Sync"
        closeId="favorites-sync-enter-close"
        onClose={onClose}
      />
      <div className="modal-body">
          <p className="modal-hint">
            Enter the 3-word sync code to pull down your favorites.
          </p>
          <input
            id="favorites-sync-enter-input"
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="the-forever-jukebox"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <p
            id="favorites-sync-enter-status"
            className={
              status
                ? status.error
                  ? "modal-status error"
                  : "modal-status"
                : "modal-status hidden"
            }
            role="status"
            aria-live="polite"
          >
            {status?.text ?? ""}
          </p>
        </div>
      <div className="modal-footer">
        <button
          id="favorites-sync-enter-button"
          type="button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Syncing..." : "Sync favorites"}
        </button>
      </div>
    </Modal>
  );
}

function FavoritesSyncCreateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const existingCode = useAppStore((s) => s.favoritesSyncCode);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [output, setOutput] = useState<string | null>(null);
  const [buttonHidden, setButtonHidden] = useState(false);

  useEffect(() => {
    if (open) {
      setStatus(null);
      setOutput(existingCode || null);
      setButtonHidden(false);
    }
    // Snapshot the existing code at open time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hint = output
    ? "Enter this code on another device to sync."
    : "Create a sync code to share your favorites between devices.";
  const buttonLabel = existingCode ? "Create new sync code" : "Create sync code";

  const submit = async () => {
    setButtonHidden(true);
    setStatus({ text: "Creating sync code...", error: false });
    try {
      const code = await createSyncCode();
      setOutput(code);
      setStatus(null);
    } catch (err) {
      setStatus({ text: "Unable to create sync code.", error: true });
      setButtonHidden(false);
      console.warn(`Favorites sync create failed: ${String(err)}`);
    }
  };

  return (
    <Modal id="favorites-sync-create-modal" open={open} onClose={onClose}>
      <ModalHeader
        title="Favorites Sync"
        closeId="favorites-sync-create-close"
        onClose={onClose}
      />
      <div className="modal-body">
          <p className="modal-hint" id="favorites-sync-create-hint">
            {hint}
          </p>
          <div
            id="favorites-sync-create-output"
            className={
              output ? "favorites-sync-code" : "favorites-sync-code hidden"
            }
          >
            {output ?? ""}
          </div>
          <p
            id="favorites-sync-create-status"
            className={
              status
                ? status.error
                  ? "modal-status error"
                  : "modal-status"
                : "modal-status hidden"
            }
            role="status"
            aria-live="polite"
          >
            {status?.text ?? ""}
          </p>
        </div>
      <div className="modal-footer">
        <button
          id="favorites-sync-create-button"
          type="button"
          className={buttonHidden ? "hidden" : undefined}
          onClick={() => void submit()}
        >
          {buttonLabel}
        </button>
      </div>
    </Modal>
  );
}

function FavoritesSyncControls({ visible }: { visible: boolean }) {
  const syncCode = useAppStore((s) => s.favoritesSyncCode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [enterOpen, setEnterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hasCode = Boolean(syncCode);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocumentClick = (event: Event) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [menuOpen]);

  // Menu closes whenever the subtab changes / controls hide.
  useEffect(() => {
    if (!visible) {
      setMenuOpen(false);
    }
  }, [visible]);

  const handleItem = (action: "refresh" | "create" | "enter") => {
    setMenuOpen(false);
    if (action === "refresh") {
      void refreshFavoritesFromSync();
    } else if (action === "create") {
      setEnterOpen(false);
      setCreateOpen(true);
    } else {
      setCreateOpen(false);
      setEnterOpen(true);
    }
  };

  return (
    <>
      <div className="favorites-sync" ref={wrapRef}>
        <button
          id="favorites-sync-button"
          className={
            visible ? "favorites-sync-button" : "favorites-sync-button hidden"
          }
          type="button"
          aria-label="Favorites sync"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
        >
          <span
            className="material-symbols-outlined favorites-sync-icon"
            aria-hidden="true"
          >
            {hasCode ? "cloud" : "cloud_off"}
          </span>
        </button>
        <div
          className={
            menuOpen ? "favorites-sync-menu" : "favorites-sync-menu hidden"
          }
          id="favorites-sync-menu"
          role="menu"
        >
          <button
            type="button"
            className={
              hasCode ? "favorites-sync-item" : "favorites-sync-item hidden"
            }
            data-favorites-sync="refresh"
            onClick={() => handleItem("refresh")}
          >
            Refresh favorites
          </button>
          <button
            type="button"
            className="favorites-sync-item"
            data-favorites-sync="create"
            onClick={() => handleItem("create")}
          >
            {hasCode ? "View sync code" : "Create sync code"}
          </button>
          <button
            type="button"
            className="favorites-sync-item"
            data-favorites-sync="enter"
            onClick={() => handleItem("enter")}
          >
            Enter sync code
          </button>
        </div>
      </div>
      <FavoritesSyncEnterModal
        open={enterOpen}
        onClose={() => setEnterOpen(false)}
      />
      <FavoritesSyncCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}

export function TopTracksPanel() {
  const subtab = useAppStore((s) => s.topSongsTab);
  const allowSync = useAppStore((s) =>
    Boolean(s.appConfig?.allow_favorites_sync),
  );
  const favoritesCount = useAppStore((s) => s.favorites.length);
  const maxFavoritesValue =
    useAppStore((s) => s.appConfig?.max_favorites) ?? maxFavorites();
  const lists = useAppStore((s) => s.topSongsLists);
  const [query, setQuery] = useState("");
  const loadList = useCallback(
    async (tabId: TopSongsListTabId, force = false) => {
      const state = useAppStore.getState();
      if (!force && state.topSongsLoadedTabs.includes(tabId)) {
        return;
      }
      // Dedupes StrictMode's double-invoked mount effect, rapid subtab flips,
      // and unmount/remount cycles while a request is still pending.
      if (state.topSongsInFlightTabs.includes(tabId)) {
        return;
      }
      const config = LIST_CONFIG[tabId];
      state.setTopSongsTabInFlight(tabId, true);
      state.setTopSongsListState(tabId, {
        kind: "message",
        text: config.loadingText,
      });
      try {
        const items = await config.fetchItems();
        useAppStore.getState().setTopSongsListState(
          tabId,
          items.length === 0
            ? { kind: "message", text: config.emptyText }
            : { kind: "loaded", items },
        );
        useAppStore.getState().setTopSongsTabLoaded(tabId, true);
      } catch (err) {
        useAppStore.getState().setTopSongsListState(tabId, {
          kind: "message",
          text: `${config.errorPrefix} unavailable: ${formatErrorForDisplay(err)}`,
        });
        console.warn(`${config.errorPrefix} load failed: ${String(err)}`);
      } finally {
        useAppStore.getState().setTopSongsTabInFlight(tabId, false);
      }
    },
    [],
  );

  useEffect(() => {
    if (subtab !== "favorites") {
      void loadList(subtab);
    }
  }, [subtab, loadList]);

  const title =
    subtab === "top"
      ? `Top ${TOP_SONGS_LIMIT}`
      : subtab === "trending"
        ? "Trending"
        : subtab === "recent"
          ? `Last ${TOP_SONGS_LIMIT} Played`
          : "Favorites";

  const subtabButton = (tabId: TopSongsTabId, content: React.ReactNode) => (
    <button
      className={subtab === tabId ? "subtab-btn active" : "subtab-btn"}
      data-top-subtab={tabId}
      onClick={() => useAppStore.setState({ topSongsTab: tabId })}
    >
      {content}
    </button>
  );

  return (
    <section className="panel tab-panel" data-tab-panel="top">
      <div className="subtabs" id="top-subtabs">
        {subtabButton("top", "All Time")}
        {subtabButton("trending", "Trending")}
        {subtabButton("recent", "Recents")}
        <span className="subtab-spacer" aria-hidden="true"></span>
        {subtabButton(
          "favorites",
          <>
            <span
              className="material-symbols-outlined subtab-icon subtab-icon-filled"
              aria-hidden="true"
            >
              star
            </span>
            <span>Favorites</span>
          </>,
        )}
      </div>
      <div className="panel-title panel-title-row">
        <span id="top-list-title">
          {title}
          {subtab === "favorites" ? (
            <>
              <br />
              <span className="favorites-count">
                {favoritesCount} / {maxFavoritesValue}
              </span>
            </>
          ) : null}
        </span>
        <button
          id="top-list-refresh"
          className={
            subtab === "favorites"
              ? "top-list-refresh-button hidden"
              : "top-list-refresh-button"
          }
          type="button"
          aria-label={`Refresh ${title}`}
          title="Refresh"
          onClick={() => {
            if (subtab !== "favorites") {
              void loadList(subtab, true);
            }
          }}
        >
          <span
            className="material-symbols-outlined top-list-refresh-icon"
            aria-hidden="true"
          >
            refresh
          </span>
        </button>
        <FavoritesSyncControls
          visible={subtab === "favorites" && allowSync}
        />
        <div
          className={
            subtab === "favorites"
              ? "favorites-filter"
              : "favorites-filter hidden"
          }
          id="favorites-filter"
        >
          <input
            id="favorites-search-input"
            className="search-input"
            type="search"
            placeholder="Search favorites"
            autoComplete="off"
            aria-label="Search favorites"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <SongList tabId="top" state={lists.top} hidden={subtab !== "top"} />
      <SongList
        tabId="trending"
        state={lists.trending}
        hidden={subtab !== "trending"}
      />
      <SongList
        tabId="recent"
        state={lists.recent}
        hidden={subtab !== "recent"}
      />
      <div
        className={
          subtab === "favorites" ? "favorites-list" : "favorites-list hidden"
        }
        id="favorites-list"
      >
        <FavoritesList query={query} />
      </div>
    </section>
  );
}
