import { togglePlayback } from "../../playback";
import {
  canMovePlaylistNext,
  canMovePlaylistPrevious,
  hasActivePlaylistControls,
} from "../../playlist";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { playlistNext, playlistPrevious } from "../../wire/playlist";

// Transport cluster: playlist previous, play/pause toggle, playlist next.
// Rendered into the .viz-play-controls container.
export function PlayControls() {
  const isRunning = useAppStore((s) => s.isRunning);
  const isPaused = useAppStore((s) => s.isPaused);
  const playMode = useAppStore((s) => s.playMode);
  const audioMode = useAppStore((s) => s.jukeboxAudioMode);
  const swingPreparing = useAppStore((s) => s.swingPreparing);
  const audioLoaded = useAppStore((s) => s.audioLoaded);
  const analysisLoaded = useAppStore((s) => s.analysisLoaded);
  const audioLoadInFlight = useAppStore((s) => s.audioLoadInFlight);
  const pollController = useAppStore((s) => s.pollController);
  const playlistLoadBusy = useAppStore((s) => s.playlistLoadBusy);
  const playlist = useAppStore((s) => s.playlist);

  // Derive the play button's label, icon and visibility from playback state.
  const isBlocked =
    playMode === "jukebox" && audioMode === "swing" && swingPreparing;
  const playLabel = isBlocked
    ? "Preparing Swing mode"
    : isRunning
      ? "Pause"
      : isPaused
        ? "Resume"
        : "Play";
  const playIcon = isBlocked
    ? "hourglass_top"
    : isRunning
      ? "pause"
      : "play_arrow";
  const playHidden = !(audioLoaded && analysisLoaded) || swingPreparing;

  const active = hasActivePlaylistControls(playlist);
  const playlistBusy =
    audioLoadInFlight ||
    pollController !== null ||
    playlistLoadBusy ||
    swingPreparing;

  return (
    <>
      <button
        id="playlist-previous"
        className={
          active ? "playlist-control" : "playlist-control is-hidden"
        }
        type="button"
        aria-label="Previous playlist track"
        title="Previous playlist track"
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
        aria-label="Next playlist track"
        title="Next playlist track"
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
