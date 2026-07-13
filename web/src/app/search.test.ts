import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { SearchDeps } from "./search";
import {
  showYoutubeMatches,
  startYoutubeAnalysisFlow,
  tryLoadExistingTrackByName,
} from "./search";
import { DEFAULT_SEARCH_RESULTS, useAppStore } from "./store";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./api", () => ({
  fetchJobByTrack: vi.fn(),
  searchYoutube: vi.fn(),
  startYoutubeAnalysis: vi.fn(),
}));

vi.mock("./playback", () => {
  let generation = 0;
  return {
    tryLoadCachedAudio: vi.fn(),
    bumpLoadGeneration: vi.fn(() => {
      generation += 1;
      return generation;
    }),
    getLoadGeneration: vi.fn(() => generation),
    isStaleLoad: vi.fn((g: number) => g !== generation),
  };
});

let api: typeof import("./api");
let playback: typeof import("./playback");

function createContext(): AppContext {
  return {
    engine: {} as unknown as AppContext["engine"],
    player: {} as unknown as AppContext["player"],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    cowbellOverlay: {} as unknown as AppContext["cowbellOverlay"],
    defaultConfig: {} as unknown as AppContext["defaultConfig"],
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




// Status setters receive LocalizedText thunks; evaluate them so assertions
// can compare the resulting strings.
function localizedCalls(mock: unknown): unknown[][] {
  return (mock as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
    call.map((arg) =>
      typeof arg === "function" ? (arg as () => unknown)() : arg,
    ),
  );
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
});

describe("search flows", () => {
  beforeEach(async () => {
    setWindowUrl("http://localhost/");
    vi.clearAllMocks();
    useAppStore.setState({
      searchQuery: "",
      searchResults: DEFAULT_SEARCH_RESULTS,
      searchHint: () => "Step 1: Find a Spotify track.",
    });
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
      source_id: "yt1",
      result: {},
    });
    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );
    expect(result).toBe(true);
    expect(useAppStore.getState().lastTrackId).toBe("job1");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("job1");
    expect(deps.applyAnalysisResult).toHaveBeenCalled();
  });

  it("does not carry current tuning into a newly selected existing track", async () => {
    const context = createContext();
    const deps = createDeps();
    deps.onNormalTrackSelected = vi.fn();
    useAppStore.setState({ tuningParams: "jb=1&thresh=30" });
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      id: "job-with-analysis",
      source_id: "yt-existing",
      result: {},
    });

    await tryLoadExistingTrackByName(context, deps, "Song", "Artist");

    expect(deps.onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job-with-analysis",
        tuningParams: null,
      }),
    );
  });

  it("returns false for missing existing analysis so caller can continue to YouTube matching", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );

    expect(result).toBe(false);
    const results = useAppStore.getState().searchResults;
    expect(results.kind).toBe("message");
    expect(results.kind === "message" && results.text()).toBe(
      "Checking existing analysis...",
    );
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
    expect(deps.pollAnalysis).not.toHaveBeenCalled();
  });

  it("polls instead of applying stale state when existing lookup is still processing", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "processing",
      id: "job-processing",
      source_id: "yt-processing",
      source_provider: "youtube",
      progress: 40,
      message: "Working",
    });

    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );

    expect(result).toBe(true);
    expect(localizedCalls(deps.setLoadingProgress)).toContainEqual([
      null,
      "Fetching audio",
    ]);
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job-processing");
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
  });

  it("treats failed existing lookup as a terminal cached result", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed",
      id: "job-f",
      source_id: "yt-f",
      error: "ERROR: [download] This video is not available.",
      error_code: "download_unavailable",
      source_provider: "youtube",
    });
    const result = await tryLoadExistingTrackByName(
      context,
      deps,
      "Song",
      "Artist",
    );
    expect(result).toBe(true);
    expect(localizedCalls(deps.setAnalysisStatus)).toContainEqual([
      "YouTube fetch failed.",
      false,
    ]);
    expect(useAppStore.getState().analysisRetryJobId).toBe("job-f");
    expect(deps.pollAnalysis).not.toHaveBeenCalled();
    expect(deps.applyAnalysisResult).not.toHaveBeenCalled();
  });

  it("starts youtube analysis flow", async () => {
    const context = createContext();
    useAppStore.setState({ tuningParams: "jb=1" });
    const deps = createDeps();
    deps.onNormalTrackSelected = vi.fn();
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "job2", status: "queued" });
    await startYoutubeAnalysisFlow(context, deps, "yt2", "Song", "Artist");
    expect(deps.onNormalTrackSelected).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job2", tuningParams: null }),
    );
    expect(api.startYoutubeAnalysis).toHaveBeenCalledWith({
      youtube_id: "yt2",
      title: "Song",
      artist: "Artist",
    });
    expect(useAppStore.getState().lastTrackId).toBe("job2");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("job2");
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job2");
  });

  it("polls the same job id when YouTube selection restarts an existing job", async () => {
    const context = createContext();
    const deps = createDeps();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: jobId,
      status: "downloading",
      source_id: "yt-retry",
      source_provider: "youtube",
    });

    await startYoutubeAnalysisFlow(
      context,
      deps,
      "yt-retry",
      "Song",
      "Artist",
    );

    expect(useAppStore.getState().lastJobId).toBe(jobId);
    expect(deps.updateTrackUrl).toHaveBeenCalledWith(jobId);
    expect(deps.pollAnalysis).toHaveBeenCalledWith(jobId);
  });

  it("publishes youtube matches to the search results store", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.searchYoutube as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "yt-match", title: "Match", duration: 123 },
    ]);

    await showYoutubeMatches(context, deps, "Song", "Artist", 123);

    expect(deps.navigateToTab).toHaveBeenCalledWith("search", { replace: true });
    expect(useAppStore.getState().searchResults).toEqual({
      kind: "youtube",
      items: [
        {
          item: { id: "yt-match", title: "Match", duration: 123 },
          name: "Song",
          artist: "Artist",
        },
      ],
    });
  });
});
