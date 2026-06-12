import type { AppContext } from "./context";
import { useAppStore } from "./store";

export type ToastOptions = {
  icon?: string;
  tone?: "default" | "error";
};

export function setAnalysisStatus(
  context: AppContext,
  message: string,
  spinning: boolean
) {
  const { elements } = context;
  elements.analysisStatus.textContent = message;
  if (spinning) {
    elements.analysisSpinner.classList.remove("hidden");
  } else {
    elements.analysisSpinner.classList.add("hidden");
    elements.analysisProgress.textContent = "";
  }
}

export function setLoadingProgress(
  context: AppContext,
  progress: number | null,
  message?: string | null
) {
  const { elements } = context;
  elements.analysisStatus.textContent = message?.trim() || "Loading";
  elements.analysisSpinner.classList.remove("hidden");
  if (typeof progress === "number") {
    elements.analysisProgress.textContent = `${Math.round(progress)}%`;
  } else {
    elements.analysisProgress.textContent = "";
  }
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
export function showToast(
  context: AppContext,
  message: string,
  options?: ToastOptions
) {
  const { state } = context;
  useAppStore.setState({
    toast: {
      message,
      icon: options?.icon,
      tone: options?.tone === "error" ? "error" : "default",
    },
  });
  if (state.toastTimer !== null) {
    window.clearTimeout(state.toastTimer);
  }
  state.toastTimer = window.setTimeout(() => {
    useAppStore.setState({ toast: null });
    state.toastTimer = null;
  }, 2000);
}
