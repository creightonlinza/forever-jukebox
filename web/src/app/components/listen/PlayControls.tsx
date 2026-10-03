import { togglePlayback } from "../../playback";
import {
  canMovePlaylistNext,
  canMovePlaylistPrevious,
  hasActivePlaylistControls,
} from "../../playlist";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { playlistNext, playlistPrevious } from "../../playlist-actions";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function playButtonLabel({
  isBlocked,
  isInstrumental,
  isWubMachine,
  isRunning,
  isPaused,
  t,
}: {
  isBlocked: boolean;
  isInstrumental: boolean;
  isWubMachine: boolean;
  isRunning: boolean;
  isPaused: boolean;
  t: TFunction;
}) {
  if (isBlocked && isWubMachine) {
    return t("playback.preparingWubMachine");
  }
  if (isBlocked) {
    return isInstrumental
      ? t("playback.preparingInstrumental")
      : t("playback.preparingSwing");
  }
  if (isRunning) {
    return t("playback.pause");
  }
  return isPaused ? t("playback.resume") : t("playback.play");
}

function playButtonIcon(isBlocked: boolean, isRunning: boolean) {
  if (isBlocked) {
    return "hourglass_top";
  }
  return isRunning ? "pause" : "play_arrow";
}

// Transport cluster: playlist previous, play/pause toggle, playlist next.
// Rendered into the .viz-play-controls container.
export function PlayControls() {
  const { t } = useTranslation();
  const isRunning = useAppStore((s) => s.isRunning);
  const isPaused = useAppStore((s) => s.isPaused);
  const playMode = useAppStore((s) => s.playMode);
  const audioMode = useAppStore((s) => s.jukeboxAudioMode);
  const audioModePreparing = useAppStore((s) => s.audioModePreparing);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioLoadInFlight = useAppStore((s) => s.audioLoadInFlight);
  const analysisPollInFlight = useAppStore((s) => s.analysisPollInFlight);
  const playlistLoadBusy = useAppStore((s) => s.playlistLoadBusy);
  const playlist = useAppStore((s) => s.playlist);

  // Derive the play button's label, icon and visibility from playback state.
  const isInstrumental = audioMode === "instrumental";
  const isWubMachine = playMode === "wubmachine";
  const isBlocked =
    audioModePreparing &&
    (isWubMachine ||
      (playMode === "jukebox" && (audioMode === "swing" || isInstrumental)));
  const playLabel = playButtonLabel({
    isBlocked,
    isInstrumental,
    isWubMachine,
    isRunning,
    isPaused,
    t,
  });
  const playIcon = playButtonIcon(isBlocked, isRunning);
  const playHidden = !(audioLoaded && analysisLoaded) || audioModePreparing;

  const active = hasActivePlaylistControls(playlist);
  const playlistBusy =
    audioLoadInFlight ||
    analysisPollInFlight ||
    playlistLoadBusy ||
    audioModePreparing;

  return (
    <>
      <button
        id="playlist-previous"
        className={
          active ? "playlist-control" : "playlist-control is-hidden"
        }
        type="button"
        aria-label={t("playlist.previous")}
        title={t("playlist.previous")}
        disabled={playlistBusy || !canMovePlaylistPrevious(playlist)}
        onClick={() => playlistPrevious()}
      >
        <span
          className="material-symbols-outlined playlist-control-icon"
          aria-hidden="true"
        >
          skip_previous
        </span>
      </button>
      <button
        type="button"
        id="viz-play"
        className={
          playHidden
            ? "play-toggle viz-play-toggle hidden"
            : "play-toggle viz-play-toggle"
        }
        aria-label={playLabel}
        title={playLabel}
        disabled={isBlocked}
        onClick={() => togglePlayback(getAppContext())}
      >
        <span
          className="material-symbols-outlined play-icon"
          aria-hidden="true"
        >
          {playIcon}
        </span>
      </button>
      <button
        id="playlist-next"
        className={
          active ? "playlist-control" : "playlist-control is-hidden"
        }
        type="button"
        aria-label={t("playlist.next")}
        title={t("playlist.next")}
        disabled={playlistBusy || !canMovePlaylistNext(playlist)}
        onClick={() => playlistNext()}
      >
        <span
          className="material-symbols-outlined playlist-control-icon"
          aria-hidden="true"
        >
          skip_next
        </span>
      </button>
    </>
  );
}
