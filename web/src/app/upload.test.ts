import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./api";
import { startUrlAnalysis, uploadAudio } from "./api";
import type { AppContext } from "./context";
import { bumpLoadGeneration, resetForNewTrack } from "./playback";
import { useAppStore } from "./store";
import { showToast } from "./ui";
import {
  normalizeSupportedSourceUrl,
  uploadFromUrl,
  type UploadDeps,
} from "./upload";

// upload.ts imports its static helpers directly now (toast, api, reset),
// so the test mocks the modules rather than injecting them as deps. The load
// generation helpers stay real so the stale-load guard exercises real state.
vi.mock("./ui", async (importActual) => ({
  ...(await importActual<typeof import("./ui")>()),
  showToast: vi.fn(),
  setLoadingProgress: vi.fn(),
}));
vi.mock("./api", async (importActual) => ({
  ...(await importActual<typeof import("./api")>()),
  uploadAudio: vi.fn(),
  startUrlAnalysis: vi.fn(),
}));
vi.mock("./playback", async (importActual) => ({
  ...(await importActual<typeof import("./playback")>()),
  resetForNewTrack: vi.fn(),
}));

const initialStoreState = useAppStore.getState();

function createHarness() {
  useAppStore.setState(initialStoreState, true);
  useAppStore.setState({
    appConfig: { allow_user_url: true } as AppConfig,
  });
  const context = {} as AppContext;
  const onNormalTrackSelected = vi.fn();
  const pollAnalysisJob = vi.fn();
  const deps: UploadDeps = {
    context,
    pollAnalysisJob,
    onNormalTrackSelected,
  };
  return { deps, onNormalTrackSelected, pollAnalysisJob };
}

describe("uploadFromUrl", () => {
  it("abandons the continuation when a newer load supersedes the upload", async () => {
    const harness = createHarness();
    vi.mocked(startUrlAnalysis).mockImplementation(async () => {
      // the user loads another track while the URL job request is in flight
      bumpLoadGeneration();
      return { status: "queued", id: "a3f3c0dc73c6476c9db95c227f9206f2", source_provider: "youtube" };
    });

    await uploadFromUrl(
      harness.deps,
      "https://www.youtube.com/watch?v=abc123def45",
    );

    expect(resetForNewTrack).not.toHaveBeenCalled();
    expect(useAppStore.getState().navigationRequest).toBeNull();
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
    const { deps } = createHarness();
    vi.mocked(startUrlAnalysis).mockRejectedValue(
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
    const { deps } = createHarness();
    vi.mocked(startUrlAnalysis).mockResolvedValue({
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
    const { deps, onNormalTrackSelected, pollAnalysisJob } = createHarness();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    useAppStore.setState({ tuningParams: "jb=1&thresh=25" });
    vi.mocked(startUrlAnalysis).mockResolvedValue({
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
    expect(useAppStore.getState().navigationRequest).toEqual({
      id: 1,
      to: `/listen/${jobId}`,
      replace: true,
    });
    expect(pollAnalysisJob).toHaveBeenCalledWith(jobId);
    expect(onAccepted).toHaveBeenCalled();
    expect(onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: jobId,
        sourceType: "youtube",
        tuningParams: null,
      }),
    );
  });

  it("does not carry current tuning into newly uploaded files", async () => {
    const { deps, onNormalTrackSelected } = createHarness();
    useAppStore.setState({
      appConfig: { allow_user_upload: true } as AppConfig,
      tuningParams: "jb=1&thresh=25",
    });
    vi.mocked(uploadAudio).mockResolvedValue({
      id: "upload-job",
      status: "queued",
    });

    await import("./upload").then(({ uploadAudioFile }) =>
      uploadAudioFile(deps, new File(["abc"], "clip.mp3")),
    );

    expect(onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "upload-job",
        sourceType: "upload",
        tuningParams: null,
      }),
    );
  });
});
