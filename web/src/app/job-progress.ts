import type { LoadingStepId } from "@forever-jukebox/shared/ui/LoadingProgress";
import i18n from "./i18n";
import type { LoadingState } from "./store";

// A load starts as a single step and switches to the analysis steps only if the server reports analysis work.
export const TRACK_STEP: LoadingState = { task: "track", activeId: "track", progress: null };

export function analysisStep(activeId: LoadingStepId, progress: number | null = null): LoadingState {
  return { task: "serverAnalysis", activeId, progress };
}

// Job progress comes from the API download (0-25) and then the engine:
// decode 0 and beats 10-85 (one step), features 85-95, then building the output (cue step).
export function jobLoadingStep(
  status: string,
  progress: number | null,
  serverMessage?: string | null,
): LoadingState {
  const p = progress ?? 0;
  if (status === "queued") {
    const ahead = serverMessage?.match(/(\d{1,9})\s+ahead/i);
    return {
      ...analysisStep("queued"),
      message: () =>
        ahead
          ? i18n.t("status.queuedAhead", { count: Number(ahead[1]) })
          : i18n.t("status.queuedNext"),
    };
  }
  if (status !== "processing") {
    return analysisStep("fetch", p > 0 ? Math.min(1, p / 25) : null);
  }
  if (p < 85) {
    return analysisStep("beats", p < 10 ? null : (p - 10) / 75);
  }
  return p < 95 ? analysisStep("features", (p - 85) / 10) : analysisStep("track");
}
