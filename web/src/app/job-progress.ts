import type { LoadingStepId } from "@forever-jukebox/shared/ui/LoadingProgress";
import { jobStep } from "@forever-jukebox/shared/ui/jobProgress";
import i18n from "./i18n";
import type { LoadingState } from "./store";

// A load starts as a single step and switches to the analysis steps only if the server reports analysis work.
export const TRACK_STEP: LoadingState = { task: "track", activeId: "track", progress: null };

export function analysisStep(activeId: LoadingStepId, progress: number | null = null): LoadingState {
  return { task: "serverAnalysis", activeId, progress };
}

export function jobLoadingStep(
  status: string,
  progress: number | null,
  serverMessage?: string | null,
): LoadingState {
  const { activeId, progress: stepProgress, queuedAhead } = jobStep(status, progress, serverMessage);
  if (activeId !== "queued") {
    return analysisStep(activeId, stepProgress);
  }
  return {
    ...analysisStep("queued"),
    message: () =>
      queuedAhead === null
        ? i18n.t("status.queuedNext")
        : i18n.t("status.queuedAhead", { count: queuedAhead }),
  };
}
