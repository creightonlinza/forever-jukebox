import type { AppContext } from "./context";
import type { MaterialSymbolIconName } from "./material-icons";
import { useAppStore, type LocalizedText } from "./store";
import i18n from "./i18n";

export type ToastOptions = {
  icon?: MaterialSymbolIconName;
  tone?: "default" | "error";
};

const TOAST_DURATION_MS = 2000;
const TOAST_EXIT_MS = 200;
const MAX_TOASTS = 3;

let nextToastId = 1;
const toastTimers = new Map<number, number>();

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

// Clearing any previous timer per id keeps drop-oldest safe: the pending
// hide is cancelled before the removal is scheduled.
function scheduleToastTimer(id: number, delay: number, fn: () => void) {
  const prev = toastTimers.get(id);
  if (prev !== undefined) {
    window.clearTimeout(prev);
  }
  toastTimers.set(id, window.setTimeout(fn, delay));
}

function beginToastExit(id: number) {
  useAppStore.setState((s) => ({
    toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
  }));
  scheduleToastTimer(id, TOAST_EXIT_MS, () => removeToast(id));
}

function removeToast(id: number) {
  toastTimers.delete(id);
  useAppStore.setState((s) => ({
    toasts: s.toasts.filter((t) => t.id !== id),
  }));
}

// The React <Toast> renders this store state; only the auto-hide timers are
// managed here. Up to MAX_TOASTS stack; the oldest is dropped for a new one.
export function showToast(message: string, options?: ToastOptions) {
  const tone = options?.tone === "error" ? "error" : "default";
  const icon = options?.icon;
  const active = useAppStore.getState().toasts.filter((t) => !t.exiting);
  const newest = active[active.length - 1];
  if (
    newest &&
    newest.message === message &&
    newest.icon === icon &&
    newest.tone === tone
  ) {
    // Identical consecutive message: refresh its timer instead of stacking
    // a duplicate.
    scheduleToastTimer(newest.id, TOAST_DURATION_MS, () =>
      beginToastExit(newest.id),
    );
    return;
  }
  if (active.length >= MAX_TOASTS) {
    beginToastExit(active[0].id);
  }
  const id = nextToastId++;
  useAppStore.setState((s) => ({
    toasts: [...s.toasts, { id, message, icon, tone, exiting: false }],
  }));
  scheduleToastTimer(id, TOAST_DURATION_MS, () => beginToastExit(id));
}
