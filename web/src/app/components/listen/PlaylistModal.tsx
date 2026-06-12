import type { AppBridge } from "../../bridge";
import { useAppStore } from "../../store";
import { Modal } from "../Modal";

export function PlaylistModal({ bridge }: { bridge: AppBridge }) {
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
        <h2>Playlist</h2>
        <button
          id="playlist-close"
          className="modal-close"
          aria-label="Close"
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
            "No playlist yet."
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
                        bridge.listenPanel.playlist.selectIndex(index)
                      }
                    >
                      <span className="playlist-item-title">
                        {track.title || "Untitled"}
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
                      aria-label={`Remove ${track.title || "track"}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        bridge.listenPanel.playlist.removeIndex(index);
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
          onClick={() => bridge.listenPanel.playlist.clear()}
        >
          Clear Playlist
        </button>
      </div>
    </Modal>
  );
}
