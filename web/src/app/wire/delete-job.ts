import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import type { ToastOptions } from "../ui";
import type { FavoritesHandlers } from "./favorites";
import { getAdminKey } from "../admin";

type DeleteJobDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  deleteJob: (jobId: string, adminKey?: string | null) => Promise<void>;
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
  let pendingDelete: {
    jobId: string;
    trackId: string | null;
    adminKey: string | null;
  } | null = null;

  function setDeleteConfirmBusy(busy: boolean) {
    elements.deleteConfirmCancel.disabled = busy;
    elements.deleteConfirmDelete.disabled = busy;
    elements.deleteConfirmDelete.classList.toggle("is-loading", busy);
    elements.deleteConfirmDelete.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function closeDeleteConfirmModal() {
    if (deleteInFlight) {
      return;
    }
    elements.deleteConfirmModal.classList.remove("open");
    pendingDelete = null;
    elements.deleteButton.focus();
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
    pendingDelete = { jobId, trackId, adminKey: getAdminKey() };
    elements.deleteConfirmModal.classList.add("open");
    elements.deleteConfirmCancel.focus();
  }

  function handleDeleteConfirmCancel() {
    closeDeleteConfirmModal();
  }

  function handleDeleteConfirmModalClick(event: MouseEvent) {
    if (event.target === elements.deleteConfirmModal) {
      closeDeleteConfirmModal();
    }
  }

  function handleDeleteConfirmKeydown(event: KeyboardEvent) {
    if (
      event.key === "Escape" &&
      elements.deleteConfirmModal.classList.contains("open")
    ) {
      event.preventDefault();
      closeDeleteConfirmModal();
    }
  }

  function handleDeleteConfirmDelete() {
    if (deleteInFlight || !pendingDelete) {
      return;
    }
    const { jobId, trackId, adminKey } = pendingDelete;
    deleteInFlight = true;
    setDeleteConfirmBusy(true);
    deleteJob(jobId, adminKey)
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
        showToast(context, "Deleted track");
      })
      .catch(() => {
        state.deleteEligibilityJobId = jobId;
        if (adminKey) {
          elements.deleteButton.classList.remove("hidden");
          showToast(context, "Unable to delete track");
        } else {
          state.deleteEligible = false;
          elements.deleteButton.classList.add("hidden");
          showToast(context, "Track can no longer be deleted");
        }
      })
      .finally(() => {
        setDeleteConfirmBusy(false);
        deleteInFlight = false;
        elements.deleteConfirmModal.classList.remove("open");
        pendingDelete = null;
      });
  }

  return {
    handleDeleteJobClick,
    handleDeleteConfirmCancel,
    handleDeleteConfirmModalClick,
    handleDeleteConfirmKeydown,
    handleDeleteConfirmDelete,
  };
}
