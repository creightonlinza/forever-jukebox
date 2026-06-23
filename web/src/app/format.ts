import type { JukeboxAudioMode } from "@forever-jukebox/engine/audio/BufferedAudioPlayer";
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

export function formatCursorTime(seconds: number) {
  const totalSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
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
  if (audioMode === "underwater" || audioMode === "cathedral") {
    return audioMode;
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
