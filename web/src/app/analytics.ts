// Thin wrapper around gtag.js. The loader is injected into served HTML by the
// API only when the host configures a measurement id, so every call here is a
// silent no-op in dev, tests, and unconfigured deployments.

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

// The injected snippet already reported the initial page load, so seed the
// dedupe state with the landing path to avoid a double page_view on mount.
let lastPageViewPath: string | null =
  typeof window === "undefined" ? null : window.location.pathname;
let lastPlayKey: string | null = null;

function gtagEvent(name: string, params: Record<string, string>): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }
  window.gtag("event", name, params);
}

export function trackEvent(name: string, params: Record<string, string> = {}): void {
  gtagEvent(name, params);
}

export function trackPageView(pathname: string): void {
  if (pathname === lastPageViewPath) {
    return;
  }
  lastPageViewPath = pathname;
  gtagEvent("page_view", {
    page_location: window.location.href,
    page_path: pathname,
  });
}

// Deduped on track+mode so pause/resume does not refire; replaying a track
// after switching away counts again.
export function trackPlay(mode: string, trackId: string | null, title: string | null): void {
  const key = `${mode}:${trackId ?? ""}`;
  if (key === lastPlayKey) {
    return;
  }
  lastPlayKey = key;
  gtagEvent("play", {
    mode,
    track_id: trackId ?? "",
    track_title: title ?? "",
  });
}

export function resetAnalyticsForTests(): void {
  lastPageViewPath = typeof window === "undefined" ? null : window.location.pathname;
  lastPlayKey = null;
}
