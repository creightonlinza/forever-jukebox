import { useEffect, useRef, useState } from "react";
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/engine/autocanonizer/AutocanonizerViz";
import {
  setAutocanonizerStreamPans,
  setMasterVolume,
} from "../../playback";
import {
  hasActivePlaylistControls,
  hasPlaylistControls,
} from "../../playlist";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { toggleFullscreen } from "../../fullscreen";
import { useTranslation } from "react-i18next";

// The right-hand cluster of the viz bottom bar: playlist-open button,
// volume panel, fullscreen toggle. Rendered into the .viz-bottom-right
// container.
export function VizBottomRight() {
  const { t } = useTranslation();
  const playlist = useAppStore((s) => s.playlist);
  const volumePct = useAppStore((s) => s.volumePct);
  const playMode = useAppStore((s) => s.playMode);
  const mainPan = useAppStore((s) => s.autocanonizerMainPan);
  const otherPan = useAppStore((s) => s.autocanonizerOtherPan);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [panOpen, setPanOpen] = useState(false);
  const volumeWrapRef = useRef<HTMLDivElement | null>(null);
  const panWrapRef = useRef<HTMLDivElement | null>(null);
  const isCanonizer = playMode === "autocanonizer";

  // Click-away closes the open audio panels.
  useEffect(() => {
    if (!volumeOpen && !panOpen) {
      return;
    }
    const onDocumentClick = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (volumeWrapRef.current?.contains(target) ||
          panWrapRef.current?.contains(target))
      ) {
        return;
      }
      setVolumeOpen(false);
      setPanOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [volumeOpen, panOpen]);

  useEffect(() => {
    if (!isCanonizer) {
      setPanOpen(false);
    }
  }, [isCanonizer]);

  const hasTracks = hasPlaylistControls(playlist);
  const active = hasActivePlaylistControls(playlist);
  const playlistTitle = active
    ? t("playlist.savedWithPosition", {
        current: playlist.currentIndex + 1,
        total: playlist.tracks.length,
      })
    : t("playlist.saved");
  const fullscreenLabel = isFullscreen
    ? t("playback.exitFullscreen")
    : t("playback.fullscreen");

  const handleVolumeChange = (pct: number) => {
    useAppStore.setState({ volumePct: pct });
    setMasterVolume(getAppContext(), pct);
  };

  const handleStreamPanChange = (stream: "main" | "other", pan: number) => {
    const nextMain = stream === "main" ? pan : mainPan;
    const nextOther = stream === "other" ? pan : otherPan;
    useAppStore.setState({
      autocanonizerMainPan: nextMain,
      autocanonizerOtherPan: nextOther,
    });
    setAutocanonizerStreamPans(getAppContext(), nextMain, nextOther);
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
      {isCanonizer ? (
        <div className="pan-control-wrap" ref={panWrapRef}>
          <div
            className={
              panOpen ? "pan-control-panel" : "pan-control-panel is-hidden"
            }
            id="autocanonizer-pan-control-panel"
          >
            <label className="stream-pan-control">
              <div className="label-line">
                <span style={{ color: AUTOCANONIZER_MAIN_COLOR }}>
                  {t("playback.blueStream")}
                </span>
                <span id="autocanonizer-main-pan-val">{mainPan}</span>
              </div>
              <input
                className="pan-slider stream-pan-slider"
                id="autocanonizer-main-pan"
                type="range"
                aria-label={t("playback.blueStreamPan")}
                min={-100}
                max={100}
                step={1}
                value={mainPan}
                style={{ accentColor: AUTOCANONIZER_MAIN_COLOR }}
                onChange={(event) =>
                  handleStreamPanChange("main", Number(event.target.value))
                }
              />
            </label>
            <label className="stream-pan-control">
              <div className="label-line">
                <span style={{ color: AUTOCANONIZER_OTHER_COLOR }}>
                  {t("playback.greenStream")}
                </span>
                <span id="autocanonizer-other-pan-val">{otherPan}</span>
              </div>
              <input
                className="pan-slider stream-pan-slider"
                id="autocanonizer-other-pan"
                type="range"
                aria-label={t("playback.greenStreamPan")}
                min={-100}
                max={100}
                step={1}
                value={otherPan}
                style={{ accentColor: AUTOCANONIZER_OTHER_COLOR }}
                onChange={(event) =>
                  handleStreamPanChange("other", Number(event.target.value))
                }
              />
            </label>
          </div>
          <button
            id="autocanonizer-pan-button"
            className="volume-button pan-button"
            aria-label={t("playback.streamPan")}
            title={t("playback.streamPan")}
            onClick={() => {
              setVolumeOpen(false);
              setPanOpen((prev) => !prev);
            }}
          >
            <span
              className="material-symbols-outlined pan-icon"
              aria-hidden="true"
            >
              swap_horiz
            </span>
          </button>
        </div>
      ) : null}
      <div className="volume-control-wrap" ref={volumeWrapRef}>
        <div
          className={
            volumeOpen ? "volume-control-panel" : "volume-control-panel is-hidden"
          }
          id="volume-control-panel"
        >
          <label>
            <input
              className="volume-slider"
              id="volume"
              type="range"
              aria-label={t("playback.volume")}
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
          aria-label={t("playback.volume")}
          onClick={() => {
            setPanOpen(false);
            setVolumeOpen((prev) => !prev);
          }}
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
