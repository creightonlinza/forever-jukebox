import { useEffect, useRef, useState } from "react";
import { setMasterVolume } from "../../playback";
import {
  hasActivePlaylistControls,
  hasPlaylistControls,
} from "../../playlist";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { toggleFullscreen } from "../../fullscreen";

// The right-hand cluster of the viz bottom bar: playlist-open button,
// volume panel, fullscreen toggle. Rendered into the .viz-bottom-right
// container.
export function VizBottomRight() {
  const playlist = useAppStore((s) => s.playlist);
  const volumePct = useAppStore((s) => s.volumePct);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-away closes the volume panel.
  useEffect(() => {
    if (!volumeOpen) {
      return;
    }
    const onDocumentClick = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target)) {
        return;
      }
      setVolumeOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [volumeOpen]);

  const hasTracks = hasPlaylistControls(playlist);
  const active = hasActivePlaylistControls(playlist);
  const playlistTitle = active
    ? `Playlist (${playlist.currentIndex + 1}/${playlist.tracks.length})`
    : "Saved Playlist";
  const fullscreenLabel = isFullscreen ? "Exit Fullscreen" : "Fullscreen";

  const handleVolumeChange = (pct: number) => {
    useAppStore.setState({ volumePct: pct });
    setMasterVolume(getAppContext(), pct);
  };

  return (
    <>
      <button
        id="playlist-open"
        className={
          hasTracks
            ? "playlist-control playlist-open-control"
            : "playlist-control playlist-open-control is-hidden"
        }
        type="button"
        aria-label={playlistTitle}
        title={playlistTitle}
        onClick={() => useAppStore.setState({ playlistModalOpen: true })}
      >
        <span
          className="material-symbols-outlined playlist-control-icon"
          aria-hidden="true"
        >
          queue_music
        </span>
      </button>
      <div className="volume-control-wrap" ref={wrapRef}>
        <div
          className={
            volumeOpen
              ? "volume-control-panel"
              : "volume-control-panel is-hidden"
          }
          id="volume-control-panel"
        >
          <label>
            <input
              className="volume-slider"
              id="volume"
              type="range"
              aria-label="Volume"
              min={0}
              max={100}
              step={1}
              value={volumePct}
              onChange={(event) =>
                handleVolumeChange(Number(event.target.value))
              }
            />
            <div className="label-line">
              <span id="volume-val">{volumePct}</span>
            </div>
          </label>
        </div>
        <button
          id="volume-button"
          className="volume-button"
          aria-label="Volume"
          onClick={() => setVolumeOpen((prev) => !prev)}
        >
          <span
            className="material-symbols-outlined volume-icon"
            aria-hidden="true"
          >
            volume_up
          </span>
        </button>
      </div>
      <button
        id="fullscreen"
        className="fullscreen-toggle"
        aria-label={fullscreenLabel}
        title={fullscreenLabel}
        onClick={() => toggleFullscreen()}
      >
        <span
          className="material-symbols-outlined fullscreen-icon"
          aria-hidden="true"
        >
          {isFullscreen ? "fullscreen_exit" : "fullscreen"}
        </span>
      </button>
    </>
  );
}
