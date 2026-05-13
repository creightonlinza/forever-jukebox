import type { JukeboxAudioMode } from "../audio/BufferedAudioPlayer";
import type { AppState } from "./context";

export function formatDuration(seconds: number) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatTrackDuration(seconds: unknown) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }
  return formatDuration(seconds);
}

export function formatAudioModeLabel(audioMode: JukeboxAudioMode) {
  if (audioMode === "cowbell") {
    return "more cowbell";
  }
  return audioMode;
}

export function formatPlaybackTitle(
  baseTitle: string,
  playMode: AppState["playMode"],
  audioMode: JukeboxAudioMode,
) {
  if (playMode === "autocanonizer") {
    return `${baseTitle} (autocanonized)`;
  }
  if (audioMode !== "off") {
    return `${baseTitle} (${formatAudioModeLabel(audioMode)})`;
  }
  return baseTitle;
}
