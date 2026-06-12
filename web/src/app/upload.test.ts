import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./api";
import type { AppContext } from "./context";
import { bumpLoadGeneration } from "./playback";
import { useAppStore } from "./store";
import {
  normalizeSupportedSourceUrl,
  uploadFromUrl,
  type UploadDeps,
} from "./upload";

const initialStoreState = useAppStore.getState();

function createHarness() {
  useAppStore.setState(initialStoreState, true);
  useAppStore.setState({
    appConfig: { allow_user_url: true } as AppConfig,
  });
  const context = {} as AppContext;
  const showToast = vi.fn();
  const startUrlAnalysis = vi.fn();
  const onNormalTrackSelected = vi.fn();
  const resetForNewTrack = vi.fn();
  const updateTrackUrl = vi.fn();
  const pollAnalysisJob = vi.fn();
  const deps: UploadDeps = {
    context,
    showToast,
    uploadAudio: vi.fn(),
    startUrlAnalysis,
    resetForNewTrack,
    setActiveTabWithRefresh: vi.fn(),
    setLoadingProgress: vi.fn(),
    updateTrackUrl,
    pollAnalysisJob,
    onNormalTrackSelected,
  };
  return {
    deps,
    onNormalTrackSelected,
    pollAnalysisJob,
    showToast,
    startUrlAnalysis,
    updateTrackUrl,
  };
}

describe("uploadFromUrl", () => {
  it("abandons the continuation when a newer load supersedes the upload", async () => {
    const harness = createHarness();
    harness.startUrlAnalysis.mockImplementation(async () => {
      // the user loads another track while the URL job request is in flight
      bumpLoadGeneration();
      return { status: "queued", id: "a3f3c0dc73c6476c9db95c227f9206f2", source_provider: "youtube" };
    });

    await uploadFromUrl(
      harness.deps,
      "https://www.youtube.com/watch?v=abc123def45",
    );

    expect(harness.deps.resetForNewTrack).not.toHaveBeenCalled();
    expect(harness.updateTrackUrl).not.toHaveBeenCalled();
    expect(harness.pollAnalysisJob).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes supported source URLs", () => {
    expect(normalizeSupportedSourceUrl("abc123def45")).toBe(
      "https://www.youtube.com/watch?v=abc123def45",
    );
    expect(
      normalizeSupportedSourceUrl("https://www.youtube.com/watch?v=abc123def45"),
    ).toBe("https://www.youtube.com/watch?v=abc123def45");
    expect(normalizeSupportedSourceUrl("https://example.com/x")).toBeNull();
    expect(normalizeSupportedSourceUrl("ftp://youtube.com/x")).toBeNull();
  });

  it("shows source-specific SoundCloud errors from URL upload failures", async () => {
    const { deps, showToast, startUrlAnalysis } = createHarness();
    startUrlAnalysis.mockRejectedValue(
      Object.assign(new Error("Error: ERROR: Unable to download video data."), {
        code: "download_unavailable",
      }),
    );

    await uploadFromUrl(deps, "https://soundcloud.com/artist/track");

    expect(showToast).toHaveBeenCalledWith(
            "SoundCloud fetch failed.",
      { icon: "error", tone: "error" },
    );
  });

  it("shows source-specific Bandcamp errors from failed URL responses", async () => {
    const { deps, showToast, startUrlAnalysis } = createHarness();
    startUrlAnalysis.mockResolvedValue({
      id: "job-bandcamp",
      status: "failed",
      source_provider: "bandcamp",
      error: "ERROR: Unable to download video data.",
      error_code: "download_unavailable",
    });

    await uploadFromUrl(deps, "https://artist.bandcamp.com/track/song");

    expect(showToast).toHaveBeenCalledWith(
            "Bandcamp fetch failed.",
      { icon: "error", tone: "error" },
    );
  });

  it("uses job id as the listen id for successful YouTube URL uploads", async () => {
    const {
      deps,
      onNormalTrackSelected,
      pollAnalysisJob,
      startUrlAnalysis,
      updateTrackUrl,
    } = createHarness();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    startUrlAnalysis.mockResolvedValue({
      id: jobId,
      status: "downloading",
      source_provider: "youtube",
    });
    const onAccepted = vi.fn();

    await uploadFromUrl(
      deps,
      "https://www.youtube.com/watch?v=abc123def45",
      onAccepted,
    );

    expect(useAppStore.getState().lastTrackId).toBe(jobId);
    expect(useAppStore.getState().pendingAutoFavoriteId).toBe(jobId);
    expect(updateTrackUrl).toHaveBeenCalledWith(jobId, true, null, "jukebox");
    expect(pollAnalysisJob).toHaveBeenCalledWith(jobId);
    expect(onAccepted).toHaveBeenCalled();
    expect(onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: jobId,
        sourceType: "youtube",
      }),
    );
  });
});
