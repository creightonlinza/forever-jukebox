import { isLikelyJobId } from "./identity";
import { loadTrackById, loadTrackByJobId } from "./playback";
import type { PlaylistTrack } from "./playlist";
import { getAppContext, getPlaybackDeps } from "./runtime";
import { useAppStore } from "./store";

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
