import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { loadTrackById } from "./playback";
import { hasTuningParamsInUrl } from "./tuning";

export async function handleRouteChange(
  context: AppContext,
  deps: PlaybackDeps,
  pathname: string
) {
  const legacyTrack = new URLSearchParams(window.location.search).get("track");
  if (legacyTrack) {
    deps.updateTrackUrl(legacyTrack, true);
    await loadTrackById(context, deps, legacyTrack);
    return;
  }
  if (pathname.startsWith("/search")) {
    deps.navigateToTab("search", { replace: true });
    return;
  }
  if (pathname.startsWith("/faq") || pathname.startsWith("/whats-new")) {
    deps.setActiveTab("faq");
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
      const { state } = context;
      const preserveUrlTuning = hasTuningParamsInUrl();
      if (
        trackId === state.lastTrackId &&
        (state.audioLoaded ||
          state.analysisLoaded ||
          state.audioLoadInFlight ||
          state.isRunning)
      ) {
        deps.navigateToTab("play", { replace: true, trackId });
        return;
      }
      deps.navigateToTab("play", { replace: true, trackId });
      await loadTrackById(context, deps, trackId, { preserveUrlTuning });
      return;
    }
    deps.navigateToTab("top", { replace: true });
    return;
  }
  deps.navigateToTab("top", { replace: true });
}
