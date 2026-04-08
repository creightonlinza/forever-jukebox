import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { loadTrackByJobId, loadTrackByYouTubeId } from "./playback";
import { hasTuningParamsInUrl } from "./tuning";

function isLikelyJobId(value: string) {
  return /^[a-f0-9]{32}$/.test(value);
}

function parseSourceRouteId(trackId: string): { provider: string; sourceId: string } {
  const marker = trackId.indexOf(":");
  if (marker > 0) {
    const provider = trackId.slice(0, marker).toLowerCase();
    const sourceId = trackId.slice(marker + 1);
    if (
      sourceId &&
      (provider === "youtube" || provider === "soundcloud" || provider === "bandcamp")
    ) {
      return { provider, sourceId };
    }
  }
  return { provider: "youtube", sourceId: trackId };
}

export async function handleRouteChange(
  context: AppContext,
  deps: PlaybackDeps,
  pathname: string
) {
  const legacyTrack = new URLSearchParams(window.location.search).get("track");
  if (legacyTrack) {
    deps.updateTrackUrl(legacyTrack, true);
    await loadTrackByYouTubeId(context, deps, legacyTrack);
    return;
  }
  if (pathname.startsWith("/search")) {
    deps.navigateToTab("search", { replace: true });
    return;
  }
  if (pathname.startsWith("/faq")) {
    deps.navigateToTab("faq", { replace: true });
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
      if (isLikelyJobId(trackId)) {
        deps.navigateToTab("play", { replace: true, youtubeId: trackId });
        await loadTrackByJobId(context, deps, trackId, { preserveUrlTuning });
        return;
      }
      if (
        trackId === state.lastYouTubeId &&
        (state.audioLoaded ||
          state.analysisLoaded ||
          state.audioLoadInFlight ||
          state.isRunning)
      ) {
        deps.navigateToTab("play", { replace: true, youtubeId: trackId });
        return;
      }
      deps.navigateToTab("play", { replace: true, youtubeId: trackId });
      const parsedSource = parseSourceRouteId(trackId);
      await loadTrackByYouTubeId(context, deps, parsedSource.sourceId, {
        preserveUrlTuning,
        sourceProvider: parsedSource.provider,
      });
      return;
    }
    deps.navigateToTab("top", { replace: true });
    return;
  }
  deps.navigateToTab("top", { replace: true });
}
