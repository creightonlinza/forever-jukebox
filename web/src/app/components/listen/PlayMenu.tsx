import { useEffect, useRef, useState } from "react";
import { isAdminMode } from "../../admin";
import type { AppBridge } from "../../bridge";
import { findCurrentFavorite } from "../../favorites";
import { formatPlaybackTitle } from "../../format";
import { useMarquee } from "../../hooks/useMarquee";
import { openInfo, openTuning } from "../../playback";
import { useAppStore } from "../../store";
import type { PendingDelete } from "../../wire/delete-job";
import { Modal } from "../Modal";

function DeleteConfirmModal({
  bridge,
  pending,
  onClosed,
}: {
  bridge: AppBridge;
  pending: PendingDelete | null;
  onClosed: () => void;
}) {
  const open = useAppStore((s) => s.deleteConfirmOpen);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    if (busy) {
      return;
    }
    useAppStore.setState({ deleteConfirmOpen: false });
    onClosed();
  };

  const confirm = async () => {
    if (busy || !pending) {
      return;
    }
    setBusy(true);
    try {
      await bridge.listenPanel.performDelete(pending);
    } finally {
      setBusy(false);
      useAppStore.setState({ deleteConfirmOpen: false });
      onClosed();
    }
  };

  return (
    <Modal
      id="delete-confirm-modal"
      open={open}
      onClose={close}
      closeOnEscape
      panelClassName="delete-confirm-panel"
      role="dialog"
      ariaModal
    >
      <div className="modal-header">
        <h2 id="delete-confirm-title">Delete track?</h2>
      </div>
      <div className="modal-footer">
        <button
          id="delete-confirm-cancel"
          type="button"
          ref={cancelRef}
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
        <button
          id="delete-confirm-delete"
          className={busy ? "danger-button is-loading" : "danger-button"}
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void confirm()}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

export function PlayMenu({ bridge }: { bridge: AppBridge }) {
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const swingPreparing = useAppStore((s) => s.swingPreparing);
  const playMode = useAppStore((s) => s.playMode);
  const audioMode = useAppStore((s) => s.jukeboxAudioMode);
  const trackTitle = useAppStore((s) => s.trackTitle);
  const trackArtist = useAppStore((s) => s.trackArtist);
  const bringItHomeMode = useAppStore((s) => s.bringItHomeMode);
  const deleteEligible = useAppStore((s) => s.deleteEligible);
  const favorites = useAppStore((s) => s.favorites);
  const lastTrackId = useAppStore((s) => s.lastTrackId);
  const lastJobId = useAppStore((s) => s.lastJobId);
  const lastSourceId = useAppStore((s) => s.lastSourceId);
  const lastSourceProvider = useAppStore((s) => s.lastSourceProvider);
  const favoriteToggleBusy = useAppStore((s) => s.favoriteToggleBusy);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);

  const hidden = !(audioLoaded && analysisLoaded) || swingPreparing;
  const isCanonizer = playMode === "autocanonizer";
  const adminMode = isAdminMode();
  const displayTitle =
    trackTitle || trackArtist
      ? (() => {
          const withSuffix = formatPlaybackTitle(
            trackTitle ?? "Unknown",
            playMode,
            audioMode,
          );
          return trackArtist ? `${withSuffix} — ${trackArtist}` : withSuffix;
        })()
      : "";
  useMarquee(titleRef, displayTitle);

  const favoriteActive = Boolean(
    findCurrentFavorite(favorites, {
      lastTrackId,
      lastJobId,
      lastSourceId,
      lastSourceProvider,
    }),
  );
  const favoriteLabel = favoriteActive
    ? "Remove from Favorites"
    : "Add to Favorites";
  const deleteLabel = adminMode
    ? "Delete track"
    : "Delete within 30 minutes of creation";

  const handleDeleteClick = () => {
    const pending = bridge.listenPanel.getPendingDelete();
    if (!pending) {
      return;
    }
    setPendingDelete(pending);
    useAppStore.setState({ deleteConfirmOpen: true });
  };

  return (
    <>
      <div
        className={hidden ? "menu-bar hidden" : "menu-bar"}
        id="play-menu"
      >
        <div className="menu-left">
          <div className="play-title" id="play-title" ref={titleRef}></div>
          <span
            id="bring-home-label"
            className={
              playMode === "jukebox" && bringItHomeMode
                ? "bring-home-note"
                : "bring-home-note is-hidden"
            }
          >
            Bringing it on home
          </span>
        </div>
        <div className="menu-right">
          <button
            id="delete-job"
            ref={deleteButtonRef}
            className={
              deleteEligible || adminMode
                ? "delete-toggle"
                : "delete-toggle hidden"
            }
            aria-label={deleteLabel}
            title={deleteLabel}
            onClick={handleDeleteClick}
          >
            <span
              className="material-symbols-outlined delete-icon"
              aria-hidden="true"
            >
              delete
            </span>
          </button>
          <button
            id="tuning"
            className={isCanonizer ? "tune-toggle is-hidden" : "tune-toggle"}
            disabled={isCanonizer}
            aria-label="Tune"
            title="Tune"
            onClick={() => openTuning(bridge.context)}
          >
            <span
              className="material-symbols-outlined tune-icon"
              aria-hidden="true"
            >
              tune
            </span>
          </button>
          <button
            id="track-info"
            className={isCanonizer ? "info-toggle is-hidden" : "info-toggle"}
            aria-label="Info"
            title="Info"
            onClick={() => openInfo(bridge.context)}
          >
            <span
              className="material-symbols-outlined info-icon"
              aria-hidden="true"
            >
              info
            </span>
          </button>
          <button
            id="short-url"
            className="copy-toggle"
            aria-label="Copy URL"
            title="Copy URL"
            onClick={() => bridge.listenPanel.copyShortUrl()}
          >
            <span
              className="material-symbols-outlined copy-icon"
              aria-hidden="true"
            >
              share
            </span>
          </button>
          <button
            id="favorite-toggle"
            className={
              `favorite-toggle${favoriteActive ? " active" : ""}` +
              `${favoriteToggleBusy ? " is-loading" : ""}`
            }
            disabled={favoriteToggleBusy}
            aria-busy={favoriteToggleBusy}
            aria-label={favoriteLabel}
            title={favoriteLabel}
            onClick={() => bridge.listenPanel.toggleFavorite()}
          >
            <span
              className="material-symbols-outlined favorite-icon"
              aria-hidden="true"
            >
              star
            </span>
          </button>
        </div>
      </div>
      <DeleteConfirmModal
        bridge={bridge}
        pending={pendingDelete}
        onClosed={() => {
          setPendingDelete(null);
          deleteButtonRef.current?.focus();
        }}
      />
    </>
  );
}
