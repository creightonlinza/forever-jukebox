import type { JukeboxAudioMode } from "@forever-jukebox/engine/audio/BufferedAudioPlayer";
import type { AppState } from "./context";
import i18n from "./i18n";

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
  const labels: Record<JukeboxAudioMode, string> = {
    off: i18n.t("common.off"),
    nightcore: i18n.t("playback.audioModeNightcore"),
    daycore: i18n.t("playback.audioModeDaycore"),
    vaporwave: i18n.t("playback.audioModeVaporwave"),
    eight_d: i18n.t("playback.audioModeEightD"),
    lofi: i18n.t("playback.audioModeLofi"),
    eight_bit: i18n.t("playback.audioModeEightBit"),
    underwater: i18n.t("playback.audioModeUnderwater"),
    cathedral: i18n.t("playback.audioModeCathedral"),
    cowbell: i18n.t("playback.audioModeCowbell"),
    swing: i18n.t("playback.audioModeSwing"),
  };
  return labels[audioMode];
}

export function formatPlaybackTitle(
  baseTitle: string,
  playMode: AppState["playMode"],
  audioMode: JukeboxAudioMode,
) {
  if (playMode === "autocanonizer") {
    return `${baseTitle} (${i18n.t("playback.autocanonized")})`;
  }
  if (audioMode !== "off") {
    return `${baseTitle} (${formatAudioModeLabel(audioMode)})`;
  }
  return baseTitle;
}
