import type { AppContext, AppState, TabId } from "../context";
import { useAppStore } from "../store";
import type { ToastOptions } from "../ui";
import type { FavoritesHandlers } from "./favorites";
import { getAdminKey } from "../admin";

type DeleteJobDeps = {
  context: AppContext;
  favoritesHandlers: Pick<FavoritesHandlers, "updateFavorites">;
  deleteJob: (jobId: string, adminKey?: string | null) => Promise<void>;
  deleteCachedTrack: (trackId: string) => Promise<void>;
  resetForNewTrack: (context: AppContext) => void;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  showToast: (message: string, options?: ToastOptions) => void;
  isFavorite: (items: AppState["favorites"], id: string) => boolean;
  removeFavorite: (items: AppState["favorites"], id: string) => AppState["favorites"];
};

export type PendingDelete = {
  jobId: string;
  trackId: string | null;
  adminKey: string | null;
};

export type DeleteJobHandlers = ReturnType<typeof createDeleteJobHandlers>;

// Deletion flow only — the delete button + confirm modal render in React
// (PlayMenu / DeleteConfirmModal) and call these.
export function createDeleteJobHandlers(deps: DeleteJobDeps) {
  const {
    context,
    favoritesHandlers,
    deleteJob,
    deleteCachedTrack,
    resetForNewTrack,
    navigateToTabWithState,
    showToast,
    isFavorite,
    removeFavorite,
  } = deps;

  function getPendingDelete(): PendingDelete | null {
    const jobId = useAppStore.getState().lastJobId;
    const trackId = useAppStore.getState().lastTrackId;
    if (!jobId) {
      return null;
    }
    return { jobId, trackId, adminKey: getAdminKey() };
  }

  async function performDelete(pending: PendingDelete): Promise<void> {
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
        favoritesHandlers.updateFavorites(
          removeFavorite(useAppStore.getState().favorites, favoriteId),
        );
      }
      resetForNewTrack(context);
      navigateToTabWithState("top", { replace: true });
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

  return { getPendingDelete, performDelete };
}
