import type { TFunction } from "i18next";
import type { AnalyzeStage } from "@/core/application/usecases/analyzeAudio";
import type { ProgressStep } from "@/ui/components/ProgressSteps";
import type { JukeboxAudioMode } from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import { VISUALIZATION_LABELS } from "@forever-jukebox/shared/constants/visualization";
import { formatAudioModeTitleLabel } from "./audioMode";
import type { PlayMode } from "./types";

export const STEP_ORDER: AnalyzeStage[] = [
  "loading",
  "decoding",
  "beats",
  "features",
  "building",
  "ready",
];

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
  if (audioMode !== "off") {
    return `${baseTitle} (${formatAudioModeTitleLabel(audioMode, t)})`;
  }
  return baseTitle;
}

export function progressStepStatus(index: number, activeIndex: number): ProgressStep["status"] {
  if (index < activeIndex) {
    return "done";
  }
  return index === activeIndex ? "active" : "pending";
}

export function analysisStageLabel(stage: AnalyzeStage, t: TFunction) {
  const keys: Record<
    Exclude<AnalyzeStage, "cached">,
    | "analysis.loading"
    | "analysis.decoding"
    | "analysis.beats"
    | "analysis.features"
    | "analysis.segments"
    | "analysis.building"
    | "analysis.ready"
  > = {
    loading: "analysis.loading",
    decoding: "analysis.decoding",
    beats: "analysis.beats",
    features: "analysis.features",
    segments: "analysis.segments",
    building: "analysis.building",
    ready: "analysis.ready",
  };
  const normalizedStage: Exclude<AnalyzeStage, "cached"> =
    stage === "cached" ? "ready" : stage;
  return t(keys[normalizedStage]);
}

export function playControlText({
  swingPreparing,
  isRunning,
  isPaused,
  t,
}: {
  swingPreparing: boolean;
  isRunning: boolean;
  isPaused: boolean;
  t: TFunction;
}) {
  if (swingPreparing) {
    return t("listen.preparingSwing");
  }
  if (isRunning) {
    return t("listen.pause");
  }
  return isPaused ? t("listen.resume") : t("listen.play");
}

export function playControlIcon(swingPreparing: boolean, isRunning: boolean) {
  if (swingPreparing) {
    return "hourglass_top";
  }
  return isRunning ? "pause" : "play_arrow";
}

export function formatPlayVelocity(velocity: number) {
  return velocity > 0 ? `+${velocity}` : `${velocity}`;
}
