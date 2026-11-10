import { createToastQueue } from "@forever-jukebox/shared/ui/toastQueue";
import type { AppContext } from "./context";
import type { MaterialSymbolIconName } from "./material-icons";
import { useAppStore, type LoadingState, type LocalizedText, type ToastState } from "./store";

export type ToastOptions = {
  icon?: MaterialSymbolIconName;
  tone?: "default" | "error";
  // Toasts sharing a key update the visible toast in place (e.g. a held
  // velocity key emits a changing readout) instead of stacking.
  key?: string;
};

// The React status panel renders these store values.
export function setAnalysisStatus(_context: AppContext, message: LocalizedText) {
  useAppStore.setState({ analysisStatusText: message, loadingStep: null, analysisRetryJobId: null });
}

// A cancelled audio-mode render hides its steps; a track load in progress keeps its own.
export function clearModeLoadingStep() {
  if (useAppStore.getState().loadingStep?.task !== "serverAnalysis") {
    useAppStore.setState({ loadingStep: null });
  }
}

// A load waiting for its first reply, before the app knows whether the track needs analysis.
export const PENDING_STEP: LoadingState = { task: "pending", activeId: "pending", progress: null };

// Audio download progress drives the last step, where loading the audio is most of the wait.
export function setTrackStepProgress(progress: number) {
  const step = useAppStore.getState().loadingStep;
  // Whole-percent changes only, so a download does not re-render the panel on every chunk.
  if (step?.activeId === "track" && Math.floor(progress * 100) !== Math.floor((step.progress ?? -1) * 100)) {
    useAppStore.setState({ loadingStep: { ...step, progress } });
  }
}

export function setLoadingStep(_context: AppContext, loadingStep: LoadingState) {
  useAppStore.setState({ loadingStep, analysisRetryJobId: null });
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "button" ||
    tag === "select" ||
    tag === "a" ||
    target.isContentEditable
  );
}

export function blurMouseActivatedControl(event: Event) {
  const detail =
    "detail" in event && typeof event.detail === "number" ? event.detail : 0;
  if (detail <= 0 || !(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  event.currentTarget.blur();
}

// The shared queue owns stacking/dedupe/timers; the React <Toast> renders
// the mirrored store state.
const toastQueue = createToastQueue<ToastState>();
toastQueue.subscribe(() => {
  useAppStore.setState({ toasts: toastQueue.getItems() });
});

export function showToast(message: string, options?: ToastOptions) {
  toastQueue.show(
    {
      message,
      icon: options?.icon,
      tone: options?.tone === "error" ? "error" : "default",
    },
    options?.key,
  );
}
