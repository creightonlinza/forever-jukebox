import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { SearchDeps } from "./search";
import { startYoutubeAnalysisFlow, tryLoadExistingTrackByName } from "./search";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./api", () => ({
  fetchJobByTrack: vi.fn(),
  startYoutubeAnalysis: vi.fn(),
}));

vi.mock("./playback", () => ({
  tryLoadCachedAudio: vi.fn(),
}));

let api: typeof import("./api");
let playback: typeof import("./playback");

function createContext(): AppContext {
  return {
    elements: {
      searchInput: { value: "" },
      searchResults: { textContent: "" },
      searchHint: { textContent: "" },
      canonizerFinish: { checked: false, addEventListener: vi.fn() },
    } as unknown as AppContext["elements"],
    engine: {} as unknown as AppContext["engine"],
    player: {} as unknown as AppContext["player"],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    defaultConfig: {} as unknown as AppContext["defaultConfig"],
    state: {
      playMode: "jukebox",
      lastYouTubeId: null,
      lastJobId: null,
      audioLoaded: false,
      analysisLoaded: false,
    } as unknown as AppContext["state"],
  };
}

function createDeps(): SearchDeps {
  return {
    setActiveTab: vi.fn(),
    navigateToTab: vi.fn(),
    updateTrackUrl: vi.fn(),
    setAnalysisStatus: vi.fn(),
    showToast: vi.fn(),
    setLoadingProgress: vi.fn(),
    pollAnalysis: vi.fn(),
    applyAnalysisResult: vi.fn(() => true),
    loadAudioFromJob: vi.fn(() => Promise.resolve(true)),
    resetForNewTrack: vi.fn(),
    updateVizVisibility: vi.fn(),
    onTrackChange: vi.fn(),
  };
}

describe("search flows", () => {
  beforeEach(async () => {
    setWindowUrl("http://localhost/");
    vi.clearAllMocks();
    api = await import("./api");
    playback = await import("./playback");
    (playback.tryLoadCachedAudio as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("loads existing track and applies analysis", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      id: "job1",
      youtube_id: "yt1",
      result: {},
    });
    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );
    expect(result).toBe(true);
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("yt1");
    expect(deps.applyAnalysisResult).toHaveBeenCalled();
  });

  it("returns false for failed existing lookup so caller can show youtube matches", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed",
      id: "job-f",
      youtube_id: "yt-f",
      error: "ERROR: [download] This video is not available.",
    });
    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );
    expect(result).toBe(false);
    expect(deps.pollAnalysis).not.toHaveBeenCalled();
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
  });

  it("starts youtube analysis flow", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "job2", status: "queued" });
    await startYoutubeAnalysisFlow(context, deps, "yt2", "Song", "Artist");
    expect(api.startYoutubeAnalysis).toHaveBeenCalledWith({
      youtube_id: "yt2",
      title: "Song",
      artist: "Artist",
    });
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("yt2");
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job2");
  });
});
