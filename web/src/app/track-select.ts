import { isLikelyJobId } from "./identity";
import { loadTrackById, loadTrackByJobId } from "./playback";
import type { PlaylistTrack } from "./playlist";
import { getAppContext, getPlaybackDeps } from "./runtime";
import { useAppStore } from "./store";

// Reloads a failed job; loadTrack retries retryable failed jobs on the
// server before polling, so this is the status-panel retry link's action.
export function retryTrack(jobId: string): void {
  const deps = getPlaybackDeps();
  if (!deps) {
    return;
  }
  // Hide the link immediately and mark this retry in flight, so a repeat
  // failure of the same job consumes the offer instead of re-showing it.
  useAppStore.setState({ analysisRetryJobId: null, retryInFlightJobId: jobId });
  void loadTrackByJobId(getAppContext(), deps, jobId);
}

export function selectTrack(
  trackId: string,
  selectedTrack: PlaylistTrack | null,
): void {
  const deps = getPlaybackDeps();
  if (!deps) {
    return;
  }
  const context = getAppContext();
  useAppStore
    .getState()
    .navigateToTabWithState("play", { trackId, tuningParams: null });
  if (isLikelyJobId(trackId)) {
    void loadTrackByJobId(context, deps, trackId, { selectedTrack });
    return;
  }
  void loadTrackById(context, deps, trackId, { selectedTrack });
}
