import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppState } from "../context";
import type { Elements } from "../elements";
import { createSearchHandlers } from "./search";

function createClassList() {
  return {
    toggle: vi.fn(),
  };
}

function createButton() {
  return {
    disabled: false,
    classList: createClassList(),
    setAttribute: vi.fn(),
  } as unknown as HTMLButtonElement;
}

function createHarness() {
  const context = {} as AppContext;
  const elements = {
    searchButton: createButton(),
    uploadFileButton: createButton(),
    uploadYoutubeButton: createButton(),
    uploadFileInput: { files: null, value: "" },
    uploadYoutubeInput: { value: "" },
  } as unknown as Elements;
  const state = {
    appConfig: { allow_user_url: true },
    tuningParams: null,
    playMode: "jukebox",
  } as unknown as AppState;
  const showToast = vi.fn();
  const startUrlAnalysis = vi.fn();
  const onNormalTrackSelected = vi.fn();
  const resetForNewTrack = vi.fn();
  const updateTrackUrl = vi.fn();
  const pollAnalysisJob = vi.fn();
  const handlers = createSearchHandlers({
    context,
    elements,
    state,
    searchDeps: {} as Parameters<typeof createSearchHandlers>[0]["searchDeps"],
    runSearch: vi.fn(),
    showToast,
    uploadAudio: vi.fn(),
    startUrlAnalysis,
    resetForNewTrack,
    setActiveTabWithRefresh: vi.fn(),
    setLoadingProgress: vi.fn(),
    updateTrackUrl,
    pollAnalysisJob,
    onNormalTrackSelected,
  });
  return {
    elements,
    handlers,
    onNormalTrackSelected,
    pollAnalysisJob,
    showToast,
    startUrlAnalysis,
    state,
    updateTrackUrl,
  };
}

describe("createSearchHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows source-specific SoundCloud errors from URL upload failures", async () => {
    const { elements, handlers, showToast, startUrlAnalysis } = createHarness();
    elements.uploadYoutubeInput.value = "https://soundcloud.com/artist/track";
    startUrlAnalysis.mockRejectedValue(
      Object.assign(new Error("Error: ERROR: Unable to download video data."), {
        code: "download_unavailable",
      }),
    );

    await handlers.handleUploadYoutubeClick();

    expect(showToast).toHaveBeenCalledWith(
      expect.anything(),
      "SoundCloud fetch failed.",
      { icon: "error", tone: "error" },
    );
  });

  it("shows source-specific Bandcamp errors from failed URL responses", async () => {
    const { elements, handlers, showToast, startUrlAnalysis } = createHarness();
    elements.uploadYoutubeInput.value = "https://artist.bandcamp.com/track/song";
    startUrlAnalysis.mockResolvedValue({
      id: "job-bandcamp",
      status: "failed",
      source_provider: "bandcamp",
      error: "ERROR: Unable to download video data.",
      error_code: "download_unavailable",
    });

    await handlers.handleUploadYoutubeClick();

    expect(showToast).toHaveBeenCalledWith(
      expect.anything(),
      "Bandcamp fetch failed.",
      { icon: "error", tone: "error" },
    );
  });

  it("uses job id as the listen id for successful YouTube URL uploads", async () => {
    const {
      elements,
      handlers,
      onNormalTrackSelected,
      pollAnalysisJob,
      startUrlAnalysis,
      state,
      updateTrackUrl,
    } = createHarness();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    elements.uploadYoutubeInput.value = "https://www.youtube.com/watch?v=abc123def45";
    startUrlAnalysis.mockResolvedValue({
      id: jobId,
      status: "downloading",
      source_provider: "youtube",
    });

    await handlers.handleUploadYoutubeClick();

    expect(state.lastTrackId).toBe(jobId);
    expect(state.pendingAutoFavoriteId).toBe(jobId);
    expect(updateTrackUrl).toHaveBeenCalledWith(jobId, true, null, "jukebox");
    expect(pollAnalysisJob).toHaveBeenCalledWith(jobId);
    expect(onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: jobId,
        sourceType: "youtube",
      }),
    );
  });
});
