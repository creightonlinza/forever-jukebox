import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppState } from "../context";
import type { Elements } from "../elements";
import type { FavoritesHandlers } from "./favorites";
import { createDeleteJobHandlers } from "./delete-job";
import { ADMIN_KEY_STORAGE_KEY } from "../admin";

function setLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    length: 0,
  } as Storage;
}

function createMutableClassList(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: vi.fn((token: string) => {
      classes.add(token);
    }),
    remove: vi.fn((token: string) => {
      classes.delete(token);
    }),
    toggle: vi.fn((token: string, force?: boolean) => {
      if (force === true) {
        classes.add(token);
        return true;
      }
      if (force === false) {
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    }),
    contains: vi.fn((token: string) => classes.has(token)),
  };
}

function createDeps() {
  const state = {
    lastJobId: "job-1",
    lastTrackId: "track-1",
    favorites: [{ id: "track-1" }],
    deleteEligible: true,
    deleteEligibilityJobId: "job-1",
  } as unknown as AppState;
  const elements = {
    deleteButton: {
      classList: createMutableClassList(),
      focus: vi.fn(),
    },
    deleteConfirmModal: {
      classList: createMutableClassList(),
    },
    deleteConfirmCancel: {
      disabled: false,
      focus: vi.fn(),
    },
    deleteConfirmDelete: {
      disabled: false,
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
  } as unknown as Elements;
  const context = { state, elements } as unknown as AppContext;
  const favoritesHandlers = {
    updateFavorites: vi.fn(),
  } as unknown as FavoritesHandlers;
  const deleteJob = vi.fn(() => Promise.resolve());
  const deleteCachedTrack = vi.fn(() => Promise.resolve());
  const resetForNewTrack = vi.fn();
  const navigateToTabWithState = vi.fn();
  const showToast = vi.fn();
  const isFavorite = vi.fn(() => true);
  const removeFavorite = vi.fn(() => []);
  const handlers = createDeleteJobHandlers({
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
  });

  return {
    handlers,
    context,
    state,
    elements,
    favoritesHandlers,
    deleteJob,
    deleteCachedTrack,
    resetForNewTrack,
    navigateToTabWithState,
    showToast,
    isFavorite,
    removeFavorite,
  };
}

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe("delete job wire handlers", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  it("opens confirmation without deleting", () => {
    const { handlers, elements, deleteJob } = createDeps();

    handlers.handleDeleteJobClick();

    expect(deleteJob).not.toHaveBeenCalled();
    expect(elements.deleteConfirmModal.classList.add).toHaveBeenCalledWith("open");
    expect(elements.deleteConfirmCancel.focus).toHaveBeenCalledTimes(1);
  });

  it("dismisses confirmation through cancel, backdrop click, and Escape", () => {
    const { handlers, elements, deleteJob } = createDeps();

    handlers.handleDeleteJobClick();
    handlers.handleDeleteConfirmCancel();

    handlers.handleDeleteJobClick();
    handlers.handleDeleteConfirmModalClick({
      target: elements.deleteConfirmModal,
    } as unknown as MouseEvent);

    handlers.handleDeleteJobClick();
    const escapeEvent = {
      key: "Escape",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    handlers.handleDeleteConfirmKeydown(escapeEvent);

    expect(deleteJob).not.toHaveBeenCalled();
    expect(elements.deleteConfirmModal.classList.remove).toHaveBeenCalledTimes(3);
    expect(elements.deleteButton.focus).toHaveBeenCalledTimes(3);
    expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("deletes the track that was pending when confirmation opened", async () => {
    const {
      handlers,
      context,
      state,
      elements,
      favoritesHandlers,
      deleteJob,
      deleteCachedTrack,
      resetForNewTrack,
      navigateToTabWithState,
      showToast,
      isFavorite,
      removeFavorite,
    } = createDeps();

    handlers.handleDeleteJobClick();
    state.lastJobId = "job-2";
    state.lastTrackId = "track-2";
    handlers.handleDeleteConfirmDelete();
    await flushPromises();

    expect(deleteJob).toHaveBeenCalledWith("job-1", null);
    expect(deleteCachedTrack).toHaveBeenCalledWith("track-1");
    expect(isFavorite).toHaveBeenCalledWith(state.favorites, "track-1");
    expect(removeFavorite).toHaveBeenCalledWith(state.favorites, "track-1");
    expect(favoritesHandlers.updateFavorites).toHaveBeenCalledWith([]);
    expect(resetForNewTrack).toHaveBeenCalledWith(context);
    expect(navigateToTabWithState).toHaveBeenCalledWith("top", { replace: true });
    expect(showToast).toHaveBeenCalledWith(context, "Deleted track");
    expect(elements.deleteConfirmModal.classList.remove).toHaveBeenCalledWith("open");
  });

  it("disables modal controls and ignores duplicate confirmation while deleting", async () => {
    const { handlers, elements, deleteJob } = createDeps();
    const deferred = {
      resolve: () => {},
      promise: Promise.resolve(),
    };
    deferred.promise = new Promise<void>((resolve) => {
      deferred.resolve = resolve;
    });
    deleteJob.mockReturnValue(deferred.promise);

    handlers.handleDeleteJobClick();
    handlers.handleDeleteConfirmDelete();
    handlers.handleDeleteConfirmDelete();

    expect(deleteJob).toHaveBeenCalledTimes(1);
    expect(elements.deleteConfirmCancel.disabled).toBe(true);
    expect(elements.deleteConfirmDelete.disabled).toBe(true);
    expect(elements.deleteConfirmDelete.classList.toggle).toHaveBeenCalledWith(
      "is-loading",
      true,
    );

    deferred.resolve();
    await flushPromises();

    expect(elements.deleteConfirmCancel.disabled).toBe(false);
    expect(elements.deleteConfirmDelete.disabled).toBe(false);
  });

  it("closes confirmation and preserves existing expired-delete failure behavior", async () => {
    const { handlers, context, state, elements, deleteJob, showToast } = createDeps();
    deleteJob.mockRejectedValue(new Error("expired"));

    handlers.handleDeleteJobClick();
    handlers.handleDeleteConfirmDelete();
    await flushPromises();

    expect(state.deleteEligible).toBe(false);
    expect(state.deleteEligibilityJobId).toBe("job-1");
    expect(elements.deleteButton.classList.add).toHaveBeenCalledWith("hidden");
    expect(showToast).toHaveBeenCalledWith(context, "Track can no longer be deleted");
    expect(elements.deleteConfirmModal.classList.remove).toHaveBeenCalledWith("open");
  });

  it("keeps delete available when an admin delete request fails", async () => {
    localStorage.setItem(ADMIN_KEY_STORAGE_KEY, "secret");
    const { handlers, context, state, elements, deleteJob, showToast } = createDeps();
    state.deleteEligible = false;
    deleteJob.mockRejectedValue(new Error("invalid admin key"));

    handlers.handleDeleteJobClick();
    handlers.handleDeleteConfirmDelete();
    await flushPromises();

    expect(deleteJob).toHaveBeenCalledWith("job-1", "secret");
    expect(state.deleteEligible).toBe(false);
    expect(elements.deleteButton.classList.remove).toHaveBeenCalledWith("hidden");
    expect(showToast).toHaveBeenCalledWith(context, "Unable to delete track");
  });
});
