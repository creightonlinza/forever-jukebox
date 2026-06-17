import type { AppContext } from "./context";
import type { MaterialSymbolIconName } from "./material-icons";
import { useAppStore } from "./store";

export type ToastOptions = {
  icon?: MaterialSymbolIconName;
  tone?: "default" | "error";
};

let toastTimer: number | null = null;

// The React status panel renders these store values.
export function setAnalysisStatus(
  _context: AppContext,
  message: string,
  spinning: boolean
) {
  useAppStore.setState(
    spinning
      ? { analysisStatusText: message, analysisSpinning: true }
      : {
          analysisStatusText: message,
          analysisSpinning: false,
          analysisProgressText: "",
        },
  );
}

export function setLoadingProgress(
  _context: AppContext,
  progress: number | null,
  message?: string | null
) {
  useAppStore.setState({
    analysisStatusText: message?.trim() || "Loading",
    analysisSpinning: true,
    analysisProgressText:
      typeof progress === "number" ? `${Math.round(progress)}%` : "",
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

// The React <Toast> renders this store state; only the auto-hide timer is
// managed here.
export function showToast(message: string, options?: ToastOptions) {
  useAppStore.setState({
    toast: {
      message,
      icon: options?.icon,
      tone: options?.tone === "error" ? "error" : "default",
    },
  });
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    useAppStore.setState({ toast: null });
    toastTimer = null;
  }, 2000);
}
