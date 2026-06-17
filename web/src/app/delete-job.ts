import { getAdminKey } from "./admin";
import { deleteJob } from "./api";
import { deleteCachedTrack } from "./cache";
import { updateFavorites } from "./favorites-actions";
import { isFavorite, removeFavorite } from "./favorites";
import { resetForNewTrack } from "./playback";
import { getAppContext } from "./runtime";
import { useAppStore } from "./store";
import { showToast } from "./ui";

export type PendingDelete = {
  jobId: string;
  trackId: string | null;
  adminKey: string | null;
};

export function getPendingDelete(): PendingDelete | null {
  const jobId = useAppStore.getState().lastJobId;
  const trackId = useAppStore.getState().lastTrackId;
  if (!jobId) {
    return null;
  }
  return { jobId, trackId, adminKey: getAdminKey() };
}

// Deletion flow only — the delete button + confirm modal render in React
// (PlayMenu / DeleteConfirmModal) and call these.
export async function performDelete(pending: PendingDelete): Promise<void> {
    const { jobId, trackId, adminKey } = pending;
    try {
      await deleteJob(jobId, adminKey);
      const favoriteId = trackId ?? jobId;
      if (favoriteId) {
        deleteCachedTrack(favoriteId).catch((err) => {
          console.warn(`Cache delete failed: ${String(err)}`);
        });
      }
      if (favoriteId && isFavorite(useAppStore.getState().favorites, favoriteId)) {
        updateFavorites(
          removeFavorite(useAppStore.getState().favorites, favoriteId),
        );
      }
      resetForNewTrack(getAppContext());
      useAppStore.getState().navigateToTabWithState("top", { replace: true });
      showToast("Deleted track");
    } catch {
      useAppStore.setState({ deleteEligibilityJobId: jobId });
      if (adminKey) {
        showToast("Unable to delete track");
      } else {
        useAppStore.setState({ deleteEligible: false });
        showToast("Track can no longer be deleted");
      }
    }
  }
