import type { TFunction } from "i18next";
import type { JukeboxAudioMode } from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import { VISUALIZATION_LABELS } from "@forever-jukebox/shared/constants/visualization";
import { formatAudioModeTitleLabel } from "./audioMode";
import type { PlayMode } from "./types";

export function getVisualizationLabel(index: number, t: TFunction) {
  return VISUALIZATION_LABELS[index] ??
    t("listen.visualizationNumber", { number: index + 1 });
}

export function formatTrackTitle(
  baseTitle: string,
  playMode: PlayMode,
  audioMode: JukeboxAudioMode,
  t: TFunction,
) {
  if (playMode === "autocanonizer") {
    return `${baseTitle} (${t("listen.autocanonized")})`;
  }
  if (playMode === "wubmachine") {
    return `${baseTitle} (${t("listen.wubMachineRemix")})`;
  }
  if (audioMode !== "off") {
    return `${baseTitle} (${formatAudioModeTitleLabel(audioMode, t)})`;
  }
  return baseTitle;
}

export type PreparingAudioMode = "swing" | "instrumental" | "wubmachine" | null;

export function playControlText({
  preparingMode,
  isRunning,
  isPaused,
  t,
}: {
  preparingMode: PreparingAudioMode;
  isRunning: boolean;
  isPaused: boolean;
  t: TFunction;
}) {
  if (preparingMode === "instrumental") {
    return t("listen.preparingInstrumental");
  }
  if (preparingMode === "swing") {
    return t("listen.preparingSwing");
  }
  if (preparingMode === "wubmachine") {
    return t("listen.preparingWubMachine");
  }
  if (isRunning) {
    return t("listen.pause");
  }
  return isPaused ? t("listen.resume") : t("listen.play");
}

export function playControlIcon(preparing: boolean, isRunning: boolean) {
  if (preparing) {
    return "hourglass_top";
  }
  return isRunning ? "pause" : "play_arrow";
}

export function formatPlayVelocity(velocity: number) {
  return velocity > 0 ? `+${velocity}` : `${velocity}`;
}
