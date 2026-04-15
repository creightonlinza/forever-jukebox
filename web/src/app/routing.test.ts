import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { handleRouteChange } from "./routing";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./playback", () => ({
  loadTrackByYouTubeId: vi.fn(),
  loadTrackByJobId: vi.fn(),
}));

let playbackModule: typeof import("./playback");

function createContext(): AppContext {
  return {
    elements: {
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
      audioLoadInFlight: false,
      isRunning: false,
    } as unknown as AppContext["state"],
  };
}

function createDeps(): PlaybackDeps {
  return {
    setActiveTab: vi.fn(),
    navigateToTab: vi.fn(),
    updateTrackUrl: vi.fn(),
    setAnalysisStatus: vi.fn(),
    setLoadingProgress: vi.fn(),
  };
}

describe("routing", () => {
  beforeEach(async () => {
    setWindowUrl("http://localhost/");
    playbackModule = await import("./playback");
    vi.clearAllMocks();
  });

  it("handles legacy track param", async () => {
    setWindowUrl("http://localhost/?track=abc123");
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("abc123", true);
    expect(playbackModule.loadTrackByYouTubeId).toHaveBeenCalled();
  });

  it("loads youtube id from /listen and preserves tuning params", async () => {
    setWindowUrl("http://localhost/listen/abc123def45?jb=1");
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/listen/abc123def45");
    expect(deps.navigateToTab).toHaveBeenCalledWith("play", {
      replace: true,
      youtubeId: "abc123def45",
    });
    expect(playbackModule.loadTrackByYouTubeId).toHaveBeenCalledWith(
      context,
      deps,
      "abc123def45",
      { preserveUrlTuning: true, sourceProvider: "youtube" },
    );
  });

  it("loads job id from /listen", async () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    setWindowUrl(`http://localhost/listen/${jobId}`);
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, `/listen/${jobId}`);
    expect(playbackModule.loadTrackByJobId).toHaveBeenCalledWith(
      context,
      deps,
      jobId,
      { preserveUrlTuning: false },
    );
  });

  it("loads source id from /listen for non-job identifiers", async () => {
    setWindowUrl("http://localhost/listen/soundcloud%3A123456");
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/listen/soundcloud%3A123456");
    expect(playbackModule.loadTrackByYouTubeId).toHaveBeenCalledWith(
      context,
      deps,
      "123456",
      { preserveUrlTuning: false, sourceProvider: "soundcloud" },
    );
  });

  it("routes to search tab", async () => {
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/search");
    expect(deps.navigateToTab).toHaveBeenCalledWith("search", { replace: true });
  });
});
