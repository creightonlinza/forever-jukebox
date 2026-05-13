import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import type { ToastOptions } from "../ui";
import type { FavoritesHandlers } from "./favorites";

type DeleteJobDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  deleteJob: (jobId: string) => Promise<void>;
  deleteCachedTrack: (trackId: string) => Promise<void>;
  resetForNewTrack: (context: AppContext) => void;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  showToast: (context: AppContext, message: string, options?: ToastOptions) => void;
  isFavorite: (items: AppState["favorites"], id: string) => boolean;
  removeFavorite: (items: AppState["favorites"], id: string) => AppState["favorites"];
};

export type DeleteJobHandlers = ReturnType<typeof createDeleteJobHandlers>;

export function createDeleteJobHandlers(deps: DeleteJobDeps) {
  const {
    context,
    elements,
    state,
    favoritesHandlers,
    deleteJob,
    deleteCachedTrack,
    resetForNewTrack,
    navigateToTabWithState,
    showToast,
    isFavorite,
    removeFavorite,
  } = deps;
  let deleteInFlight = false;

  function setDeleteButtonBusy(busy: boolean) {
    elements.deleteButton.disabled = busy;
    elements.deleteButton.classList.toggle("is-loading", busy);
    elements.deleteButton.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function handleDeleteJobClick() {
    if (deleteInFlight) {
      return;
    }
    const jobId = state.lastJobId;
    const trackId = state.lastTrackId;
    if (!jobId) {
      return;
    }
    deleteInFlight = true;
    setDeleteButtonBusy(true);
    deleteJob(jobId)
      .then(() => {
        const favoriteId = trackId ?? jobId;
        if (favoriteId) {
          deleteCachedTrack(favoriteId).catch((err) => {
            console.warn(`Cache delete failed: ${String(err)}`);
          });
        }
        if (favoriteId && isFavorite(state.favorites, favoriteId)) {
          favoritesHandlers.updateFavorites(
            removeFavorite(state.favorites, favoriteId),
          );
        }
        resetForNewTrack(context);
        navigateToTabWithState("top", { replace: true });
        showToast(context, "Deleted song");
      })
      .catch(() => {
        state.deleteEligible = false;
        state.deleteEligibilityJobId = jobId;
        elements.deleteButton.classList.add("hidden");
        showToast(context, "Song can no longer be deleted");
      })
      .finally(() => {
        setDeleteButtonBusy(false);
        deleteInFlight = false;
      });
  }

  return { handleDeleteJobClick };
}
