import type { TFunction } from "i18next";
import type { JukeboxAudioMode } from "@forever-jukebox/shared/audio/BufferedAudioPlayer";

export const MAX_RANDOM_BRANCH_DELTA = 0.2;
export const RANDOM_BRANCH_DELTA_PERCENT_SCALE = 100 / MAX_RANDOM_BRANCH_DELTA;
export const MIN_JUMP_DISTANCE_OPTIONS = [0, 5, 10, 20, 30] as const;

export type ExtrasFormState = {
  branchStatsEnabled: boolean;
  bringItHomeMode: boolean;
  audioMode: JukeboxAudioMode;
  audioIntensity: number;
};

export type TuneFormState = {
  threshold: number;
  computedThreshold: number;
  minProb: number;
  maxProb: number;
  ramp: number;
  volume: number;
  highlightAnchorBranch: boolean;
  justBackwards: boolean;
  minLongBranchPercent: number;
  removeSequentialBranches: boolean;
};

export function formatMinJumpDistance(percent: number, t: TFunction) {
  return percent === 0
    ? t("tuning.anyDistance")
    : t("tuning.percentOfTrack", { percent });
}
