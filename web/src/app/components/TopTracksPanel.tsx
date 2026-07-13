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
import i18n from "../i18n";
import { useTranslation } from "react-i18next";

type TopSongsTabId = "top" | "trending" | "recent" | "favorites";

const LIST_CONFIG: Record<
  TopSongsListTabId,
  {
    loadingText: () => string;
    emptyText: () => string;
    errorPrefix: () => string;
    listId: string;
    fetchItems: () => Promise<TopSongsItem[]>;
  }
> = {
  top: {
    loadingText: () => i18n.t("topTracks.loadingTop"),
    emptyText: () => i18n.t("topTracks.emptyTop"),
    errorPrefix: () => i18n.t("topTracks.topError"),
    listId: "top-songs",
    fetchItems: () => fetchTopSongs(TOP_SONGS_LIMIT),
  },
  trending: {
    loadingText: () => i18n.t("topTracks.loadingTrending"),
    emptyText: () => i18n.t("topTracks.emptyTrending"),
    errorPrefix: () => i18n.t("topTracks.trendingError"),
    listId: "trending-songs",
    fetchItems: () => fetchTrendingSongs(),
  },
  recent: {
    loadingText: () => i18n.t("topTracks.loadingRecent"),
    emptyText: () => i18n.t("topTracks.emptyRecent"),
    errorPrefix: () => i18n.t("topTracks.recentError"),
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

function topSongKey(item: TopSongsItem, label: string) {
  if (typeof item.id === "string" && item.id) {
    return item.id;
  }
  return `${item.source_provider ?? ""}\u0000${item.source_id ?? ""}\u0000${label}`;
}

function modalStatusClassName(status: { error?: boolean } | null) {
  if (!status) {
    return "modal-status hidden";
  }
  return status.error ? "modal-status error" : "modal-status";
}

function topSongsTitle(subtab: TopSongsTabId) {
  switch (subtab) {
    case "top":
      return i18n.t("topTracks.top25");
    case "trending":
      return i18n.t("topTracks.trending");
    case "recent":
      return i18n.t("topTracks.recent");
    case "favorites":
      return i18n.t("common.favorites");
  }
}

function nextFavoritesSort(
  prev: FavoritesDisplaySort,
  key: FavoritesDisplaySort["key"],
): FavoritesDisplaySort {
  if (prev.key !== key) {
    return { key, direction: "asc" };
  }
  return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
}

function PlaylistAddButton({
  track,
  onAdd,
}: {
  track: PlaylistTrack;
  onAdd: (track: PlaylistTrack) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="playlist-add-button"
      title={t("playlist.add")}
      aria-label={t("playlist.addNamed", {
        title: track.title || t("common.track"),
      })}
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
  const { t } = useTranslation();
  const config = LIST_CONFIG[tabId];
  const className = hidden ? "top-list hidden" : "top-list";
  if (state.kind === "message") {
    return (
      <ol className={className} id={config.listId}>
        {state.text()}
      </ol>
    );
  }
  return (
    <ol className={className} id={config.listId}>
      {state.items.slice(0, TOP_SONGS_LIMIT).map((item) => {
        const title =
          typeof item.title === "string" ? item.title : t("common.untitled");
        const artist = typeof item.artist === "string" ? item.artist : "";
        const jobId = typeof item.id === "string" ? item.id : "";
        const sourceProvider =
          typeof item.source_provider === "string" ? item.source_provider : "";
        const sourceType = normalizePlaylistSourceType(sourceProvider);
        const listenId = jobId;
        const label = artist ? `${title} — ${artist}` : title;
        const key = topSongKey(item, label);
        if (!listenId) {
          return <li key={key}>{label}</li>;
        }
        const playlistTrack: PlaylistTrack = {
          id: jobId || listenId,
          sourceType,
          title,
          artist,
          duration: null,
        };
        return (
          <li key={key} className="top-list-item">
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
  const { t } = useTranslation();
  const favorites = useAppStore((s) => s.favorites);
  const [sort, setSort] = useState<FavoritesDisplaySort>({
    key: "title",
    direction: "asc",
  });

  const handleSortClick = (key: FavoritesDisplaySort["key"]) => {
    setSort((prev) => nextFavoritesSort(prev, key));
  };

  const select = (item: FavoriteTrack) => {
    selectFavorite(item.uniqueSongId, item.sourceType ?? "youtube");
  };

  const trimmedQuery = query.trim();
  if (favorites.length === 0) {
    return <>{t("favorites.none")}</>;
  }
  const visibleFavorites = filterFavorites(favorites, trimmedQuery);
  if (visibleFavorites.length === 0) {
    return <>{t("favorites.noneMatching", { query: trimmedQuery })}</>;
  }

  const sortHeader = (key: FavoritesDisplaySort["key"], label: string) => {
    const active = sort.key === key;
    let ariaSort: "ascending" | "descending" | "none" = "none";
    if (active) {
      ariaSort = sort.direction === "asc" ? "ascending" : "descending";
    }
    return (
      <th scope="col" aria-sort={ariaSort}>
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
          {sortHeader("title", t("favorites.titleColumn"))}
          {sortHeader("artist", t("favorites.artistColumn"))}
          <th
            scope="col"
            className="favorite-remove-heading"
            aria-label={t("favorites.remove")}
          ></th>
        </tr>
      </thead>
      <tbody>
        {sortFavoritesForDisplay(visibleFavorites, sort).map((item) => {
          const sourceType = item.sourceType ?? "youtube";
          const titleText = item.title || t("common.untitled");
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
                        title={t("favorites.customTuning")}
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
                  aria-label={t("favorites.removeNamed", { title: titleText })}
                  title={t("favorites.removeNamed", { title: titleText })}
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
  const { t } = useTranslation();
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
      setStatus({ text: t("favorites.enterCodeFirst"), error: true });
      return;
    }
    setBusy(true);
    setStatus({ text: t("favorites.syncing"), error: false });
    try {
      const result = await enterSyncCode(code);
      if (result === "replaced") {
        setStatus({ text: t("favorites.updated"), error: false });
        onClose();
      } else {
        setStatus(null);
      }
    } catch (err) {
      setStatus({ text: t("favorites.unableToSync"), error: true });
      console.warn(`Favorites sync failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    submit().catch((err) => {
      setStatus({ text: t("favorites.unableToSync"), error: true });
      console.warn(`Favorites sync failed: ${String(err)}`);
      setBusy(false);
    });
  };

  return (
    <Modal id="favorites-sync-enter-modal" open={open} onClose={onClose}>
      <ModalHeader
        title={t("favorites.syncTitle")}
        closeId="favorites-sync-enter-close"
        onClose={onClose}
      />
      <div className="modal-body">
          <p className="modal-hint">
            {t("favorites.enterHint")}
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
                handleSubmit();
              }
            }}
          />
          <p
            id="favorites-sync-enter-status"
            className={modalStatusClassName(status)}
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
          onClick={handleSubmit}
        >
          {busy ? t("favorites.syncingAction") : t("favorites.syncAction")}
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
  const { t } = useTranslation();
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
    ? t("favorites.shareHint")
    : t("favorites.createHint");
  const buttonLabel = existingCode
    ? t("favorites.createNewCode")
    : t("favorites.createCode");

  const submit = async () => {
    setButtonHidden(true);
    setStatus({ text: t("favorites.creatingCode"), error: false });
    try {
      const code = await createSyncCode();
      setOutput(code);
      setStatus(null);
    } catch (err) {
      setStatus({ text: t("favorites.unableToCreateCode"), error: true });
      setButtonHidden(false);
      console.warn(`Favorites sync create failed: ${String(err)}`);
    }
  };

  const handleSubmit = () => {
    submit().catch((err) => {
      setStatus({ text: t("favorites.unableToCreateCode"), error: true });
      setButtonHidden(false);
      console.warn(`Favorites sync create failed: ${String(err)}`);
    });
  };

  return (
    <Modal id="favorites-sync-create-modal" open={open} onClose={onClose}>
      <ModalHeader
        title={t("favorites.syncTitle")}
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
            className={modalStatusClassName(status)}
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
          onClick={handleSubmit}
        >
          {buttonLabel}
        </button>
      </div>
    </Modal>
  );
}

function FavoritesSyncControls({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
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
      refreshFavoritesFromSync().catch((err) => {
        console.warn(`Favorites refresh failed: ${String(err)}`);
      });
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
          aria-label={t("favorites.sync")}
          title={t("favorites.sync")}
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
            {t("favorites.refreshAction")}
          </button>
          <button
            type="button"
            className="favorites-sync-item"
            data-favorites-sync="create"
            onClick={() => handleItem("create")}
          >
            {hasCode ? t("favorites.viewCode") : t("favorites.createCode")}
          </button>
          <button
            type="button"
            className="favorites-sync-item"
            data-favorites-sync="enter"
            onClick={() => handleItem("enter")}
          >
            {t("favorites.enterCode")}
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
  const { t } = useTranslation();
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
          text: () =>
            i18n.t("topTracks.unavailable", {
              section: config.errorPrefix(),
              error: formatErrorForDisplay(err),
            }),
        });
        console.warn(`${config.errorPrefix()} load failed: ${String(err)}`);
      } finally {
        useAppStore.getState().setTopSongsTabInFlight(tabId, false);
      }
    },
    [],
  );

  useEffect(() => {
    if (subtab !== "favorites") {
      loadList(subtab).catch((err) => {
        console.warn(`Top tracks load failed: ${String(err)}`);
      });
    }
  }, [subtab, loadList]);

  const title = topSongsTitle(subtab);

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
        {subtabButton("top", t("topTracks.allTime"))}
        {subtabButton("trending", t("topTracks.trending"))}
        {subtabButton("recent", t("topTracks.recents"))}
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
            <span>{t("common.favorites")}</span>
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
          aria-label={t("topTracks.refresh", { title })}
          title={t("topTracks.refreshTitle")}
          onClick={() => {
            if (subtab !== "favorites") {
              loadList(subtab, true).catch((err) => {
                console.warn(`Top tracks refresh failed: ${String(err)}`);
              });
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
            placeholder={t("favorites.searchPlaceholder")}
            autoComplete="off"
            aria-label={t("favorites.searchPlaceholder")}
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
