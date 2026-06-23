import { useEffect, useRef, useState } from "react";
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/engine/autocanonizer/AutocanonizerViz";
import {
  setAutocanonizerStreamVolumes,
  setMasterVolume,
} from "../../playback";
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
  const playMode = useAppStore((s) => s.playMode);
  const mainVolumePct = useAppStore((s) => s.autocanonizerMainVolumePct);
  const otherVolumePct = useAppStore((s) => s.autocanonizerOtherVolumePct);
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

  const handleStreamVolumeChange = (
    stream: "main" | "other",
    pct: number,
  ) => {
    const nextMain = stream === "main" ? pct : mainVolumePct;
    const nextOther = stream === "other" ? pct : otherVolumePct;
    useAppStore.setState({
      autocanonizerMainVolumePct: nextMain,
      autocanonizerOtherVolumePct: nextOther,
    });
    setAutocanonizerStreamVolumes(getAppContext(), nextMain, nextOther);
  };

  const isCanonizer = playMode === "autocanonizer";

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
              ? `volume-control-panel${isCanonizer ? " is-canonizer" : ""}`
              : `volume-control-panel is-hidden${isCanonizer ? " is-canonizer" : ""}`
          }
          id="volume-control-panel"
        >
          {isCanonizer ? (
            <>
              <label className="stream-volume-control">
                <div className="label-line">
                  <span style={{ color: AUTOCANONIZER_MAIN_COLOR }}>
                    Blue stream
                  </span>
                  <span id="autocanonizer-main-volume-val">
                    {mainVolumePct}
                  </span>
                </div>
                <input
                  className="volume-slider stream-volume-slider"
                  id="autocanonizer-main-volume"
                  type="range"
                  aria-label="Blue stream volume"
                  min={0}
                  max={100}
                  step={1}
                  value={mainVolumePct}
                  style={{ accentColor: AUTOCANONIZER_MAIN_COLOR }}
                  onChange={(event) =>
                    handleStreamVolumeChange(
                      "main",
                      Number(event.target.value),
                    )
                  }
                />
              </label>
              <label className="stream-volume-control">
                <div className="label-line">
                  <span style={{ color: AUTOCANONIZER_OTHER_COLOR }}>
                    Green stream
                  </span>
                  <span id="autocanonizer-other-volume-val">
                    {otherVolumePct}
                  </span>
                </div>
                <input
                  className="volume-slider stream-volume-slider"
                  id="autocanonizer-other-volume"
                  type="range"
                  aria-label="Green stream volume"
                  min={0}
                  max={100}
                  step={1}
                  value={otherVolumePct}
                  style={{ accentColor: AUTOCANONIZER_OTHER_COLOR }}
                  onChange={(event) =>
                    handleStreamVolumeChange(
                      "other",
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            </>
          ) : (
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
          )}
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
