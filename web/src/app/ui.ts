import { createToastQueue } from "@forever-jukebox/shared/ui/toastQueue";
import type { AppContext } from "./context";
import type { MaterialSymbolIconName } from "./material-icons";
import { useAppStore, type LocalizedText, type ToastState } from "./store";
import i18n from "./i18n";

export type ToastOptions = {
  icon?: MaterialSymbolIconName;
  tone?: "default" | "error";
  // Toasts sharing a key update the visible toast in place (e.g. a held
  // velocity key emits a changing readout) instead of stacking.
  key?: string;
};

// The React status panel renders these store values.
export function setAnalysisStatus(
  _context: AppContext,
  message: LocalizedText,
  spinning: boolean
) {
  useAppStore.setState(
    spinning
      ? {
          analysisStatusText: message,
          analysisSpinning: true,
          analysisRetryJobId: null,
        }
      : {
          analysisStatusText: message,
          analysisSpinning: false,
          analysisProgressText: "",
          analysisRetryJobId: null,
        },
  );
}

export function setLoadingProgress(
  _context: AppContext,
  progress: number | null,
  message?: LocalizedText | null
) {
  useAppStore.setState({
    analysisStatusText: () => message?.().trim() || i18n.t("common.loading"),
    analysisSpinning: true,
    analysisProgressText:
      typeof progress === "number" ? `${Math.round(progress)}%` : "",
    analysisRetryJobId: null,
  });
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
