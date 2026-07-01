import { useAppStore } from "../../store";
import {
  clearPlaylist,
  removePlaylistIndex,
  selectPlaylistIndex,
} from "../../playlist-actions";
import { Modal } from "../Modal";
import { useTranslation } from "react-i18next";

export function PlaylistModal() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.playlistModalOpen);
  const playlist = useAppStore((s) => s.playlist);
  const close = () => useAppStore.setState({ playlistModalOpen: false });
  const isEmpty = playlist.tracks.length === 0;

  return (
    <Modal
      id="playlist-modal"
      open={open}
      onClose={close}
      panelClassName="playlist-panel"
    >
      <div className="modal-header">
        <h2>{t("playlist.title")}</h2>
        <button
          id="playlist-close"
          className="modal-close"
          aria-label={t("common.close")}
          onClick={close}
        >
          <span
            className="material-symbols-outlined modal-close-icon"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </div>
      <div className="modal-body">
        <div id="playlist-list" className="playlist-list-wrap">
          {isEmpty ? (
            t("playlist.none")
          ) : (
            <ol className="playlist-list">
              {playlist.tracks.map((track, index) => {
                const isCurrent = index === playlist.currentIndex;
                return (
                  <li
                    key={`${track.id}-${index}`}
                    className={
                      isCurrent ? "playlist-item is-current" : "playlist-item"
                    }
                  >
                    <button
                      type="button"
                      className="playlist-select"
                      data-playlist-index={index}
                      disabled={isCurrent}
                      onClick={() =>
                        selectPlaylistIndex(index)
                      }
                    >
                      <span className="playlist-item-title">
                        {track.title || t("common.untitled")}
                      </span>
                      <span className="playlist-item-artist">
                        {track.artist || ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="playlist-remove"
                      data-playlist-index={index}
                      disabled={isCurrent}
                      aria-label={t("playlist.removeNamed", {
                        title: track.title || t("common.track"),
                      })}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removePlaylistIndex(index);
                      }}
                    >
                      <span
                        className="material-symbols-outlined playlist-remove-icon"
                        aria-hidden="true"
                      >
                        close
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button
          id="playlist-clear"
          type="button"
          disabled={isEmpty}
          onClick={() => clearPlaylist()}
        >
          {t("playlist.clear")}
        </button>
      </div>
    </Modal>
  );
}
