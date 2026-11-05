import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useAppStore } from "../../store";
import {
  clearPlaylist,
  movePlaylistIndex,
  removePlaylistIndex,
  selectPlaylistIndex,
} from "../../playlist-actions";
import { playlistTrackKey } from "../../playlist";
import { Modal } from "../Modal";
import { useTranslation } from "react-i18next";

type DragState = {
  from: number;
  over: number;
  offset: number;
  pitch: number;
};

type DragGesture = DragState & {
  pointerId: number;
  startY: number;
  startScroll: number;
  wrapTop: number;
  wrapBottom: number;
  clientY: number;
  frame: number;
};

const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_STEP_PX = 10;

// How far a row is translated while another row is dragged across it.
function rowShift(index: number, drag: DragState) {
  if (index === drag.from) {
    return drag.offset;
  }
  if (drag.from < drag.over && index > drag.from && index <= drag.over) {
    return -drag.pitch;
  }
  if (drag.over < drag.from && index >= drag.over && index < drag.from) {
    return drag.pitch;
  }
  return 0;
}

export function PlaylistModal() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.playlistModalOpen);
  const playlist = useAppStore((s) => s.playlist);
  const close = () => useAppStore.setState({ playlistModalOpen: false });
  const isEmpty = playlist.tracks.length === 0;
  const canReorder = playlist.tracks.length > 1;

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const pendingFocusKey = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const syncDrag = () => {
    const gesture = gestureRef.current;
    const wrap = wrapRef.current;
    if (!gesture || !wrap) {
      return;
    }
    const count = useAppStore.getState().playlist.tracks.length;
    const rawOffset =
      gesture.clientY - gesture.startY + wrap.scrollTop - gesture.startScroll;
    const offset = Math.min(
      Math.max(rawOffset, -gesture.from * gesture.pitch),
      (count - 1 - gesture.from) * gesture.pitch,
    );
    gesture.offset = offset;
    gesture.over = gesture.from + Math.round(offset / gesture.pitch);
    setDrag({
      from: gesture.from,
      over: gesture.over,
      offset,
      pitch: gesture.pitch,
    });
  };

  // Scrolls the list while the pointer rests near its top or bottom edge.
  const autoScroll = () => {
    const gesture = gestureRef.current;
    const wrap = wrapRef.current;
    if (!gesture || !wrap) {
      return;
    }
    const intoTop = gesture.wrapTop + AUTO_SCROLL_EDGE_PX - gesture.clientY;
    const intoBottom = gesture.clientY - (gesture.wrapBottom - AUTO_SCROLL_EDGE_PX);
    const depth = Math.max(intoTop, intoBottom);
    if (depth > 0) {
      const step = Math.ceil(
        (Math.min(depth, AUTO_SCROLL_EDGE_PX) / AUTO_SCROLL_EDGE_PX) *
          AUTO_SCROLL_MAX_STEP_PX,
      );
      const before = wrap.scrollTop;
      wrap.scrollTop += intoTop > 0 ? -step : step;
      if (wrap.scrollTop !== before) {
        syncDrag();
      }
    }
    gesture.frame = requestAnimationFrame(autoScroll);
  };

  const endDrag = useCallback((commit: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }
    gestureRef.current = null;
    cancelAnimationFrame(gesture.frame);
    setDrag(null);
    if (commit && gesture.over !== gesture.from) {
      movePlaylistIndex(gesture.from, gesture.over);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      endDrag(false);
    }
  }, [open, endDrag]);

  useEffect(() => () => endDrag(false), [endDrag]);

  useEffect(() => {
    const key = pendingFocusKey.current;
    if (!key) {
      return;
    }
    pendingFocusKey.current = null;
    const index = playlist.tracks.findIndex(
      (track) => playlistTrackKey(track) === key,
    );
    listRef.current?.children[index]
      ?.querySelector<HTMLButtonElement>(".playlist-drag-handle")
      ?.focus();
  }, [playlist.tracks]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    const items = listRef.current?.children;
    const wrap = wrapRef.current;
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      gestureRef.current ||
      !items ||
      items.length < 2 ||
      !wrap
    ) {
      return;
    }
    const pitch =
      (items[1] as HTMLElement).offsetTop - (items[0] as HTMLElement).offsetTop;
    if (pitch <= 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const wrapRect = wrap.getBoundingClientRect();
    gestureRef.current = {
      from: index,
      over: index,
      offset: 0,
      pitch,
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: wrap.scrollTop,
      wrapTop: wrapRect.top,
      wrapBottom: wrapRect.bottom,
      clientY: event.clientY,
      frame: requestAnimationFrame(autoScroll),
    };
    setDrag({ from: index, over: index, offset: 0, pitch });
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    gesture.clientY = event.clientY;
    syncDrag();
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    if (gestureRef.current?.pointerId === event.pointerId) {
      endDrag(commit);
    }
  };

  const moveWithKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    key: string,
  ) => {
    const step =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (step === 0 || gestureRef.current) {
      return;
    }
    event.preventDefault();
    const to = index + step;
    if (to < 0 || to >= playlist.tracks.length) {
      return;
    }
    pendingFocusKey.current = key;
    movePlaylistIndex(index, to);
  };

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
          type="button"
          id="playlist-close"
          className="modal-close"
          aria-label={t("common.close")}
          title={t("common.close")}
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
        <div id="playlist-list" ref={wrapRef} className="playlist-list-wrap">
          {isEmpty ? (
            t("playlist.none")
          ) : (
            <ol
              ref={listRef}
              className={drag ? "playlist-list is-dragging" : "playlist-list"}
            >
              {playlist.tracks.map((track, index) => {
                const isCurrent = index === playlist.currentIndex;
                const key = playlistTrackKey(track);
                const title = track.title || t("common.track");
                const isDragged = drag?.from === index;
                const classes = ["playlist-item"];
                if (isCurrent) {
                  classes.push("is-current");
                }
                if (isDragged) {
                  classes.push("is-dragging");
                }
                const shift = drag ? rowShift(index, drag) : 0;
                return (
                  <li
                    key={key}
                    className={classes.join(" ")}
                    style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                  >
                    <button
                      type="button"
                      className="playlist-drag-handle"
                      disabled={!canReorder}
                      aria-label={t("playlist.reorderNamed", { title })}
                      title={t("playlist.reorderHint")}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      onPointerDown={(event) => startDrag(event, index)}
                      onPointerMove={moveDrag}
                      onPointerUp={(event) => finishDrag(event, true)}
                      onPointerCancel={(event) => finishDrag(event, false)}
                      onLostPointerCapture={(event) => finishDrag(event, false)}
                      onKeyDown={(event) => moveWithKeyboard(event, index, key)}
                    >
                      <span
                        className="material-symbols-outlined playlist-drag-icon"
                        aria-hidden="true"
                      >
                        drag_handle
                      </span>
                    </button>
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
                      {/* A blank artist keeps the line so every row has the drag's pitch. */}
                      <span className="playlist-item-artist">
                        {track.artist || "\u00a0"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="playlist-remove"
                      data-playlist-index={index}
                      disabled={isCurrent}
                      aria-label={t("playlist.removeNamed", { title })}
                      title={t("playlist.removeNamed", { title })}
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
