import type { AppContext } from "./context";
import { useAppStore } from "./store";
import type { PlaybackDeps } from "./playback";
import { loadTrackById } from "./playback";
import { hasTuningParamsInUrl } from "./tuning";

export async function handleRouteChange(
  context: AppContext,
  deps: PlaybackDeps,
  pathname: string
) {
  if (pathname.startsWith("/search")) {
    useAppStore.getState().navigateToTabWithState("search", { replace: true });
    return;
  }
  if (pathname.startsWith("/faq") || pathname.startsWith("/whats-new")) {
    useAppStore.getState().setActiveTab("faq");
    return;
  }
  if (pathname.startsWith("/listen")) {
    const parts = pathname.split("/").filter(Boolean);
    const rawTrackId = parts.length >= 2 ? parts[1] : null;
    let trackId: string | null = rawTrackId;
    if (rawTrackId) {
      try {
        trackId = decodeURIComponent(rawTrackId);
      } catch {
        trackId = rawTrackId;
      }
    }
    if (trackId) {
      const preserveUrlTuning = hasTuningParamsInUrl();
      if (
        trackId === useAppStore.getState().lastTrackId &&
        (useAppStore.getState().audioLoaded ||
          useAppStore.getState().analysisLoaded ||
          useAppStore.getState().audioLoadInFlight ||
          useAppStore.getState().isRunning)
      ) {
        useAppStore.getState().navigateToTabWithState("play", { replace: true, trackId });
        return;
      }
      useAppStore.getState().navigateToTabWithState("play", { replace: true, trackId });
      await loadTrackById(context, deps, trackId, {
        preserveUrlTuning,
        preservePlaylist: true,
      });
      return;
    }
    useAppStore.getState().navigateToTabWithState("top", { replace: true });
    return;
  }
  useAppStore.getState().navigateToTabWithState("top", { replace: true });
}
