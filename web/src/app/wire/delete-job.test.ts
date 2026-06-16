import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteJob } from "../api";
import { deleteCachedTrack } from "../cache";
import type { AppContext } from "../context";
import type { FavoriteTrack } from "../favorites";
import { resetForNewTrack } from "../playback";
import { useAppStore } from "../store";
import { showToast } from "../ui";
import { createDeleteJobHandlers } from "./delete-job";

vi.mock("../api", () => ({ deleteJob: vi.fn(async () => {}) }));
vi.mock("../cache", () => ({ deleteCachedTrack: vi.fn(async () => {}) }));
vi.mock("../playback", () => ({ resetForNewTrack: vi.fn() }));
vi.mock("../ui", () => ({ showToast: vi.fn() }));

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

function createHarness() {
  useAppStore.setState(initialStoreState, true);
  const context = {} as AppContext;
  const favoritesHandlers = { updateFavorites: vi.fn() };
  const navigateToTabWithState = vi.fn();
  const handlers = createDeleteJobHandlers({
    context,
    favoritesHandlers,
    navigateToTabWithState,
  });
  return { handlers, context, favoritesHandlers, navigateToTabWithState };
}

describe("performDelete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(initialStoreState, true);
  });

  it("deletes the job, clears cache + favorite, resets, navigates, and toasts", async () => {
    const { handlers, context, favoritesHandlers, navigateToTabWithState } =
      createHarness();
    useAppStore.setState({ favorites: [favorite("track1")] });

    await handlers.performDelete({
      jobId: "job1",
      trackId: "track1",
      adminKey: null,
    });

    expect(deleteJob).toHaveBeenCalledWith("job1", null);
    // favoriteId = trackId ?? jobId
    expect(deleteCachedTrack).toHaveBeenCalledWith("track1");
    expect(favoritesHandlers.updateFavorites).toHaveBeenCalledWith([]);
    expect(resetForNewTrack).toHaveBeenCalledWith(context);
    expect(navigateToTabWithState).toHaveBeenCalledWith("top", {
      replace: true,
    });
    expect(showToast).toHaveBeenCalledWith("Deleted track");
  });

  it("removes only the favorite matching the deleted id, leaving others", async () => {
    const { handlers, favoritesHandlers } = createHarness();
    useAppStore.setState({
      favorites: [favorite("track1"), favorite("other")],
    });

    await handlers.performDelete({
      jobId: "job1",
      trackId: "track1",
      adminKey: null,
    });

    // favoriteId = trackId ?? jobId = "track1"; only that favorite is removed.
    expect(favoritesHandlers.updateFavorites).toHaveBeenCalledWith([
      favorite("other"),
    ]);
  });

  it("matches the favorite by job id when there is no track id", async () => {
    const { handlers, favoritesHandlers } = createHarness();
    useAppStore.setState({ favorites: [favorite("job1"), favorite("other")] });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: null,
    });

    // favoriteId falls back to jobId, so the job's favorite is the one removed.
    expect(favoritesHandlers.updateFavorites).toHaveBeenCalledWith([
      favorite("other"),
    ]);
  });

  it("falls back to the job id for cache delete when no track id", async () => {
    const { handlers, favoritesHandlers } = createHarness();
    useAppStore.setState({ favorites: [] });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: null,
    });

    expect(deleteCachedTrack).toHaveBeenCalledWith("job1");
    // Not a favorite, so no favorites mutation.
    expect(favoritesHandlers.updateFavorites).not.toHaveBeenCalled();
  });

  it("passes the admin key through to deleteJob", async () => {
    const { handlers } = createHarness();

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: "secret",
    });

    expect(deleteJob).toHaveBeenCalledWith("job1", "secret");
  });

  it("marks the track ineligible and toasts on a non-admin failure", async () => {
    vi.mocked(deleteJob).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const { handlers, navigateToTabWithState } = createHarness();
    useAppStore.setState({ deleteEligible: true });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: null,
    });

    expect(useAppStore.getState().deleteEligibilityJobId).toBe("job1");
    expect(useAppStore.getState().deleteEligible).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Track can no longer be deleted");
    expect(navigateToTabWithState).not.toHaveBeenCalled();
  });

  it("keeps eligibility on an admin failure and shows a generic error", async () => {
    vi.mocked(deleteJob).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const { handlers } = createHarness();
    useAppStore.setState({ deleteEligible: true });

    await handlers.performDelete({
      jobId: "job1",
      trackId: null,
      adminKey: "secret",
    });

    expect(useAppStore.getState().deleteEligibilityJobId).toBe("job1");
    // Admin path does not flip deleteEligible.
    expect(useAppStore.getState().deleteEligible).toBe(true);
    expect(showToast).toHaveBeenCalledWith("Unable to delete track");
  });
});
