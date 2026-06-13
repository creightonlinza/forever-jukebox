import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import type { FavoriteTrack } from "../favorites";
import { useAppStore } from "../store";
import { createDeleteJobHandlers } from "./delete-job";

const initialStoreState = useAppStore.getState();

function favorite(id: string): FavoriteTrack {
  return {
    uniqueSongId: id,
    title: id,
    artist: "",
    duration: null,
    sourceType: "youtube",
  };
}

function createHarness(overrides: Record<string, unknown> = {}) {
  useAppStore.setState(initialStoreState, true);
  const context = {} as AppContext;
  const deps = {
    context,
    favoritesHandlers: { updateFavorites: vi.fn() },
    deleteJob: vi.fn(async () => {}),
    deleteCachedTrack: vi.fn(async () => {}),
    resetForNewTrack: vi.fn(),
    navigateToTabWithState: vi.fn(),
    showToast: vi.fn(),
    isFavorite: vi.fn((items: FavoriteTrack[], id: string) =>
      items.some((item) => item.uniqueSongId === id),
    ),
    removeFavorite: vi.fn((items: FavoriteTrack[], id: string) =>
      items.filter((item) => item.uniqueSongId !== id),
    ),
    ...overrides,
  };
  const handlers = createDeleteJobHandlers(deps as never);
  return { handlers, deps, context };
}

describe("performDelete", () => {
  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
  });

  it("deletes the job, clears cache + favorite, resets, navigates, and toasts", async () => {
    const { handlers, deps, context } = createHarness();
    useAppStore.setState({ favorites: [favorite("track1")] });

    await handlers.performDelete({
      jobId: "job1",
      trackId: "track1",
      adminKey: null,
    });

    expect(deps.deleteJob).toHaveBeenCalledWith("job1", null);
    // favoriteId = trackId ?? jobId
    expect(deps.deleteCachedTrack).toHaveBeenCalledWith("track1");
    expect(deps.isFavorite).toHaveBeenCalledWith(
      useAppStore.getState().favorites,
      "track1",
    );
    expect(deps.favoritesHandlers.updateFavorites).toHaveBeenCalledWith([]);
    expect(deps.resetForNewTrack).toHaveBeenCalledWith(context);
    expect(deps.navigateToTabWithState).toHaveBeenCalledWith("top", {
      replace: true,
    });
    expect(deps.showToast).toHaveBeenCalledWith("Deleted track");
  });

  it("falls back to the job id for cache delete when no track id", async () => {
    const { handlers, deps } = createHarness();
    useAppStore.setState({ favorites: [] });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: null,
    });

    expect(deps.deleteCachedTrack).toHaveBeenCalledWith("job1");
    // Not a favorite, so no favorites mutation.
    expect(deps.favoritesHandlers.updateFavorites).not.toHaveBeenCalled();
  });

  it("passes the admin key through to deleteJob", async () => {
    const { handlers, deps } = createHarness();

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: "secret",
    });

    expect(deps.deleteJob).toHaveBeenCalledWith("job1", "secret");
  });

  it("marks the track ineligible and toasts on a non-admin failure", async () => {
    const { handlers, deps } = createHarness({
      deleteJob: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    useAppStore.setState({ deleteEligible: true });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: null,
    });

    expect(useAppStore.getState().deleteEligibilityJobId).toBe("job1");
    expect(useAppStore.getState().deleteEligible).toBe(false);
    expect(deps.showToast).toHaveBeenCalledWith(
      "Track can no longer be deleted",
    );
    expect(deps.navigateToTabWithState).not.toHaveBeenCalled();
  });

  it("keeps eligibility on an admin failure and shows a generic error", async () => {
    const { handlers, deps } = createHarness({
      deleteJob: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    useAppStore.setState({ deleteEligible: true });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: "secret",
    });

    expect(useAppStore.getState().deleteEligibilityJobId).toBe("job1");
    // Admin path does not flip deleteEligible.
    expect(useAppStore.getState().deleteEligible).toBe(true);
    expect(deps.showToast).toHaveBeenCalledWith("Unable to delete track");
  });
});
