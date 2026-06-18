import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppState } from "./context";
import type { AnalysisComplete } from "./api";
import {
  applyExtrasChanges,
  applyAnalysisResult,
  getExtrasFormValues,
  getTuningFormValues,
  resetExtrasDefaults,
  resetTuningDefaults,
  applyTuningChanges,
  cancelPoll,
  loadAudioFromJob,
  loadTrackById,
  openExtras,
  pollAnalysis,
  resetForNewTrack,
  setSleepTimer,
  startJukeboxFromBeat,
  stopPlayback,
  syncDeletedEdgeState,
  togglePlayback,
  updateVizVisibility,
  updateListenTimeDisplay,
  type TuningFormValues,
} from "./playback";
import { setAppRuntime } from "./runtime";
import { useAppStore } from "./store";
import { showToast } from "./ui";
import {
  handleEdgeSelect,
  handleKeydown,
  handleKeyup,
  initializePlayback,
  resetPlaybackUiForTest,
} from "./playback-ui";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./ui", async (importActual) => ({
  ...(await importActual<typeof import("./ui")>()),
  showToast: vi.fn(),
  // The real isEditableTarget references HTMLElement, undefined in this
  // DOM-less test env; the keyboard handlers only need a falsy result.
  isEditableTarget: vi.fn(() => false),
}));
vi.mock("./playback", async (importActual) => ({
  ...(await importActual<typeof import("./playback")>()),
  syncDeletedEdgeState: vi.fn(),
  updateTrackInfo: vi.fn(),
}));
import { getOrCreateSwingBuffer } from "@forever-jukebox/engine/audio/swingBufferCache";
import { renderSwingBuffer } from "@forever-jukebox/engine/audio/swingRenderer";
import { ADMIN_KEY_STORAGE_KEY } from "./admin";

vi.mock("@forever-jukebox/engine/audio/swingBufferCache", () => ({
  getOrCreateSwingBuffer: vi.fn(
    (
      _sourceBuffer: AudioBuffer,
      _sourceIdentity: string | null,
      render: () => Promise<AudioBuffer>,
    ) => render(),
  ),
}));

vi.mock("@forever-jukebox/engine/audio/swingRenderer", () => ({
  renderSwingBuffer: vi.fn(async () => ({ duration: 120 }) as AudioBuffer),
}));

vi.mock("./cache", () => ({
  readCachedTrack: vi.fn(async () => null),
  updateCachedTrack: vi.fn(async () => undefined),
  deleteCachedTrack: vi.fn(async () => undefined),
}));



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
  } as Storage;
  return store;
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true }) as Response),
  );
  setLocalStorage();
  vi.mocked(getOrCreateSwingBuffer).mockImplementation(
    (
      _sourceBuffer: AudioBuffer,
      _sourceIdentity: string | null,
      render: () => Promise<AudioBuffer>,
    ) => render(),
  );
  vi.mocked(renderSwingBuffer).mockResolvedValue({ duration: 120 } as AudioBuffer);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});


async function flushMicrotasks(count = 5) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}



type TestAppContext = AppContext & {
  autocanonizer: NonNullable<AppContext["autocanonizer"]>;
  jukebox: NonNullable<AppContext["jukebox"]>;
};

function createContext(overrides?: Partial<AppContext>): TestAppContext {
  // the old plain-object harness defaulted the active tab to "play"
  useAppStore.setState({ activeTabId: "play" });
  const engineConfig = {
    maxBranches: 4,
    maxBranchThreshold: 80,
    currentThreshold: 0,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.02,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
    minLongBranch: 0,
  };
  let userAnchorEdgeId: number | null = null;
  const engine = {
    getConfig: vi.fn(() => ({ ...engineConfig })),
    updateConfig: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(engineConfig, partial);
    }),
    rebuildGraph: vi.fn(),
    loadAnalysis: vi.fn(),
    getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
    getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
    pauseJukebox: vi.fn(),
    syncToPlaybackPosition: vi.fn(),
    startJukebox: vi.fn(),
    play: vi.fn(),
    stopJukebox: vi.fn(),
    resetStats: vi.fn(),
    clearDeletedEdges: vi.fn(),
    deleteEdge: vi.fn(),
    seekToBeat: vi.fn(),
    setForceBranch: vi.fn(),
    setBringItHomeMode: vi.fn(),
    setUserAnchorEdge: vi.fn((edge: { id: number } | null) => {
      userAnchorEdgeId = edge ? edge.id : null;
    }),
    getUserAnchorEdgeId: vi.fn(() => userAnchorEdgeId),
    getSectionStartBeatIndices: vi.fn(() => []),
    onUpdate: vi.fn(),
  };
  const player = {
    getVolume: vi.fn(() => 0.5),
    getDuration: vi.fn(() => null),
    setVolume: vi.fn(),
    setOnEnded: vi.fn(),
    play: vi.fn(),
    isPlaying: vi.fn(() => true),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setJukeboxAudioMode: vi.fn(),
    getSourceBuffer: vi.fn(() => null),
    setRenderedJukeboxAudioBuffer: vi.fn(),
  };
  const autocanonizer = {
    setAnalysis: vi.fn(),
    setAudio: vi.fn(),
    setVolume: vi.fn(),
    setFinishOutSong: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    isReady: vi.fn(() => false),
    setOnBeat: vi.fn(),
    setOnEnded: vi.fn(),
    setOnSelect: vi.fn(),
    setVisible: vi.fn(),
    resizeNow: vi.fn(),
  };
  const jukebox = {
    setData: vi.fn(),
    setAnchorHighlightEnabled: vi.fn(),
    setSelectedEdge: vi.fn(),
    setSelectedEdgeActive: vi.fn(),
    resizeActive: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    update: vi.fn(),
  };
  const cowbellOverlay = {
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(() => false),
    handleBeatEnter: vi.fn(),
    cancelScheduledHits: vi.fn(),
    setSectionStartBeatIndices: vi.fn(),
    setVolume: vi.fn(),
    dispose: vi.fn(),
  };
  const context = {
    engine: engine as unknown as AppContext["engine"],
    player: player as unknown as AppContext["player"],
    autocanonizer: autocanonizer as unknown as AppContext["autocanonizer"],
    jukebox: jukebox as unknown as AppContext["jukebox"],
    cowbellOverlay: cowbellOverlay as unknown as AppContext["cowbellOverlay"],
    defaultConfig: engineConfig as unknown as AppContext["defaultConfig"],
    ...overrides,
  } as TestAppContext;
  // Flows that read the runtime singleton (e.g. setSleepTimer) resolve to this
  // test's context.
  setAppRuntime(context);
  return context;
}

function formValues(
  context: AppContext,
  overrides?: Partial<TuningFormValues>,
): TuningFormValues {
  return { ...getTuningFormValues(context), ...overrides };
}

describe("playback tuning", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setWindowUrl("http://localhost/listen/abc");
  });

  it("reads tuning form values from config and graph", () => {
    const context = createContext();
    useAppStore.setState({ highlightAnchorBranch: true });
    const form = getTuningFormValues(context);
    expect(form.threshold).toBe(45);
    expect(form.computedThreshold).toBe(45);
    expect(form.minProbPct).toBe(18);
    expect(form.maxProbPct).toBe(50);
    expect(form.highlightAnchorBranch).toBe(true);
  });

  it("preserves selected tuning while resetting for a new track", () => {
    setWindowUrl("http://localhost/listen/favorite?jb=1&d=2,8");
    const context = createContext();
    useAppStore.setState({ lastTrackId: "old-track" });
    useAppStore.setState({ tuningParams: "jb=1&d=2,8" });

    resetForNewTrack(context, { clearTuning: false });

    expect(useAppStore.getState().tuningParams).toBe("jb=1&d=2,8");
    expect(window.location.search).toBe("?jb=1&d=2,8");
  });

  it("applies tuning changes and normalizes min/max", () => {
    const context = createContext();
    const result = applyTuningChanges(
      context,
      formValues(context, {
        minProbPct: 80,
        maxProbPct: 10,
        rampPct: 10,
        threshold: 50,
        computedThreshold: 50,
      }),
    );
    expect(result.minProbPct).toBe(10);
    expect(result.maxProbPct).toBe(80);
    expect(context.engine.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        currentThreshold: 0,
        minRandomBranchChance: 0.1,
        maxRandomBranchChance: 0.8,
      }),
    );
    expect(result.threshold).toBe(45);
  });

  it("updates visualization data when tuning changes apply", () => {
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        rebuildGraph: vi.fn(),
        getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
        getVisualizationData: vi.fn(() => ({ beats: [1], edges: [1] })),
      } as unknown as AppContext["engine"],
      jukebox: {
        setData: vi.fn(),
        setAnchorHighlightEnabled: vi.fn(),
        setSelectedEdge: vi.fn(),
        resizeActive: vi.fn(),
        reset: vi.fn(),
        update: vi.fn(),
      } as unknown as AppContext["jukebox"],
    });
    applyTuningChanges(
      context,
      formValues(context, { threshold: 40, computedThreshold: 45 }),
    );
    expect(useAppStore.getState().vizData).toEqual({ beats: [1], edges: [1] });
    expect(context.jukebox.setData).toHaveBeenCalledWith({ beats: [1], edges: [1] });
  });

  it("persists forced-branch highlight preference in localStorage", () => {
    const context = createContext();

    applyTuningChanges(
      context,
      formValues(context, { highlightAnchorBranch: true }),
    );

    expect(useAppStore.getState().highlightAnchorBranch).toBe(true);
    expect(localStorage.getItem("fj-highlight-anchor-branch")).toBe("1");
    expect(context.jukebox.setAnchorHighlightEnabled).toHaveBeenCalledWith(true);
  });

  it("applies branch stats toggle and audio mode from extras controls", () => {
    const context = createContext();
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({ playMode: "jukebox" });

    const result = applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      branchStatsEnabled: true,
      audioMode: "daycore",
    });

    expect(result).toEqual({ branchStatsChanged: true, audioModeChanged: true });
    expect(useAppStore.getState().branchStatsEnabled).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("daycore");
    expect(localStorage.getItem("fj-branch-stats-enabled")).toBe("1");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("daycore");
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
  });

  it("applies cowbell as an audio mode from extras controls", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });

    const result = applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      audioMode: "cowbell",
    });

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(useAppStore.getState().jukeboxAudioMode).toBe("cowbell");
    expect(context.cowbellOverlay.enable).toHaveBeenCalledTimes(1);
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("cowbell");
    expect(window.location.search).toContain("am=cowbell");
  });

  it("applies eight-bit as an audio mode from extras controls", () => {
    const context = createContext();
    useAppStore.setState({ analysisLoaded: true });
    useAppStore.setState({ audioLoaded: true });

    const result = applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      audioMode: "eight_bit",
    });

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(useAppStore.getState().jukeboxAudioMode).toBe("eight_bit");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("eight_bit");
    expect(window.location.search).toContain("am=eight_bit");
  });

  it("applies underwater as an audio mode from extras controls", () => {
    const context = createContext();

    const result = applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      audioMode: "underwater",
    });

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(useAppStore.getState().jukeboxAudioMode).toBe("underwater");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("underwater");
    expect(window.location.search).toContain("am=underwater");
  });

  it("applies cathedral as an audio mode from extras controls", () => {
    const context = createContext();

    const result = applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      audioMode: "cathedral",
    });

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(useAppStore.getState().jukeboxAudioMode).toBe("cathedral");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("cathedral");
    expect(window.location.search).toContain("am=cathedral");
  });

  it("resumes jukebox playback after preparing swing while already running", async () => {
    (globalThis.window as unknown as { setInterval: typeof setInterval }).setInterval =
      setInterval;
    (globalThis.window as unknown as { clearInterval: typeof clearInterval }).clearInterval =
      clearInterval;
    (globalThis.window as unknown as { setTimeout: typeof setTimeout }).setTimeout =
      setTimeout;
    (globalThis.window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
      clearTimeout;
    vi.stubGlobal("document", { fullscreenElement: null });
    const context = createContext();
    const sourceBuffer = { duration: 120 } as AudioBuffer;
    const swingBuffer = { duration: 120 } as AudioBuffer;
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ analysisLoaded: true });
    useAppStore.setState({
      vizData: {
      beats: [{ start: 0, duration: 1 }],
      edges: [],
    } as unknown as AppState["vizData"]
    });
    vi.mocked(context.player.getDuration).mockReturnValue(120);
    vi.mocked(context.player.getSourceBuffer).mockReturnValue(sourceBuffer);
    vi.mocked(renderSwingBuffer).mockResolvedValue(swingBuffer);

    applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      audioMode: "swing",
    });
    await flushMicrotasks();

    expect(context.engine.pauseJukebox).toHaveBeenCalledTimes(1);
    expect(context.player.setRenderedJukeboxAudioBuffer).toHaveBeenCalledWith(
      "swing",
      swingBuffer,
    );
    expect(context.engine.startJukebox).toHaveBeenLastCalledWith(false);
    expect(context.engine.play).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().isRunning).toBe(true);
    expect(useAppStore.getState().isPaused).toBe(false);
  });

  it("applies bring it home mode from extras controls", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ shiftBranching: true });

    applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      bringItHomeMode: true,
    });

    expect(useAppStore.getState().bringItHomeMode).toBe(true);
    expect(useAppStore.getState().shiftBranching).toBe(false);
    expect(context.engine.setForceBranch).toHaveBeenCalledWith(false);
    expect(context.engine.setBringItHomeMode).toHaveBeenCalledWith(true);
  });

  it("hides branch stats popup when extras branch stats is disabled", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ branchStatsEnabled: true });

    applyExtrasChanges(context, {
      ...getExtrasFormValues(),
      branchStatsEnabled: false,
    });

    expect(useAppStore.getState().branchStats).toBeNull();
  });

  it("resets extras options to defaults", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ branchStatsEnabled: true });
    useAppStore.setState({ bringItHomeMode: true });
    useAppStore.setState({ jukeboxAudioMode: "nightcore" });

    const result = resetExtrasDefaults(context);

    expect(result).toEqual({ branchStatsChanged: true, audioModeChanged: true });
    expect(useAppStore.getState().branchStatsEnabled).toBe(false);
    expect(localStorage.getItem("fj-branch-stats-enabled")).toBe("0");
    expect(useAppStore.getState().bringItHomeMode).toBe(false);
    expect(context.engine.setBringItHomeMode).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("off");
    expect(context.cowbellOverlay.disable).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().branchStats).toBeNull();
  });

  it("preserves audio mode URL param when tuning reset clears other tuning params", () => {
    setWindowUrl("http://localhost/listen/abc?jb=1&thresh=30&ab=7&am=daycore");
    const context = createContext();
    useAppStore.setState({ tuningParams: "jb=1&thresh=30&ab=7&am=daycore" });
    useAppStore.setState({ jukeboxAudioMode: "daycore" });
    context.engine.setUserAnchorEdge(
      { id: 7 } as Parameters<AppContext["engine"]["setUserAnchorEdge"]>[0],
    );

    resetTuningDefaults(context);

    expect(useAppStore.getState().tuningParams).toBe("am=daycore");
    expect(window.location.search).toBe("?am=daycore");
    expect(useAppStore.getState().jukeboxAudioMode).toBe("daycore");
  });

  it("resets audio mode on track change", () => {
    setWindowUrl("http://localhost/listen/abc?am=daycore");
    const context = createContext();
    useAppStore.setState({ analysisLoaded: true });
    useAppStore.setState({ jukeboxAudioMode: "daycore" });

    resetForNewTrack(context);

    expect(useAppStore.getState().jukeboxAudioMode).toBe("off");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("off");
    expect(window.location.search).not.toContain("am=daycore");
  });

  it("applies deleted edges from url when analysis loads", () => {
    setWindowUrl("http://localhost/listen/abc?d=1,3");
    const graph = {
      currentThreshold: 45,
      allEdges: [
        { id: 1, deleted: false },
        { id: 2, deleted: false },
        { id: 3, deleted: false },
      ],
      totalBeats: 0,
    };
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        loadAnalysis: vi.fn(),
        getSectionStartBeatIndices: vi.fn(() => []),
        getGraphState: vi.fn(() => graph),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn((edge: { deleted: boolean }) => {
          edge.deleted = true;
        }),
        rebuildGraph: vi.fn(),
      } as unknown as AppContext["engine"],
    });

    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: {} },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(
      (context.engine.deleteEdge as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(2);
    expect(graph.allEdges[0].deleted).toBe(true);
    expect(graph.allEdges[2].deleted).toBe(true);
    expect(useAppStore.getState().deletedEdgeIds).toEqual([1, 3]);
  });

  it("keeps track deletion visible for admin mode regardless of track age", () => {
    localStorage.setItem(ADMIN_KEY_STORAGE_KEY, "secret");
    const context = createContext();
    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      created_at: "2020-01-01T00:00:00Z",
      result: { beats: [], track: {} },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(useAppStore.getState().deleteEligible).toBe(false);
    expect(useAppStore.getState().deleteEligibilityJobId).toBe("job123");
  });

  it("retains grace-window delete eligibility and label outside admin mode", () => {
    const context = createContext();
    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      created_at: new Date().toISOString(),
      result: { beats: [], track: {} },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(useAppStore.getState().deleteEligible).toBe(true);
  });

  it("applies anchor branch from url when analysis loads", () => {
    setWindowUrl("http://localhost/listen/abc?ab=3");
    const anchorEdge = {
      id: 3,
      deleted: false,
      src: { which: 8 },
      dest: { which: 2 },
    };
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        loadAnalysis: vi.fn(),
        getSectionStartBeatIndices: vi.fn(() => []),
        getGraphState: vi.fn(() => ({
          currentThreshold: 45,
          allEdges: [anchorEdge],
          totalBeats: 0,
        })),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn(),
        rebuildGraph: vi.fn(),
        setUserAnchorEdge: vi.fn(),
        getUserAnchorEdgeId: vi.fn(() => 3),
      } as unknown as AppContext["engine"],
    });

    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: {} },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(context.engine.setUserAnchorEdge).toHaveBeenCalledWith(anchorEdge);
    expect(useAppStore.getState().tuningParams).toContain("ab=3");
  });

  it("ignores forward anchor branch ids from url", () => {
    setWindowUrl("http://localhost/listen/abc?ab=4");
    const forwardEdge = {
      id: 4,
      deleted: false,
      src: { which: 2 },
      dest: { which: 8 },
    };
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        loadAnalysis: vi.fn(),
        getSectionStartBeatIndices: vi.fn(() => []),
        getGraphState: vi.fn(() => ({
          currentThreshold: 45,
          allEdges: [forwardEdge],
          totalBeats: 0,
        })),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn(),
        rebuildGraph: vi.fn(),
        setUserAnchorEdge: vi.fn(),
        getUserAnchorEdgeId: vi.fn(() => null),
      } as unknown as AppContext["engine"],
    });

    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: {} },
    };

    applyAnalysisResult(context, response);

    expect(context.engine.setUserAnchorEdge).not.toHaveBeenCalled();
  });

  it("adds nightcore suffix to displayed title in jukebox mode", () => {
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        loadAnalysis: vi.fn(),
        getSectionStartBeatIndices: vi.fn(() => []),
        getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn(),
        rebuildGraph: vi.fn(),
      } as unknown as AppContext["engine"],
    });
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ jukeboxAudioMode: "nightcore" });

    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: { title: "Song", artist: "Artist" } },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(useAppStore.getState().trackTitle).toBe("Song");
    expect(useAppStore.getState().trackArtist).toBe("Artist");
    expect(useAppStore.getState().jukeboxAudioMode).toBe("nightcore");
  });

  it("applies audio mode from URL params when loading analysis", () => {
    setWindowUrl("http://localhost/listen/abc?am=daycore");
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        loadAnalysis: vi.fn(),
        getSectionStartBeatIndices: vi.fn(() => [4, 12]),
        getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn(),
        rebuildGraph: vi.fn(),
      } as unknown as AppContext["engine"],
    });
    useAppStore.setState({ playMode: "jukebox" });
    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: { title: "Song", artist: "Artist" } },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(useAppStore.getState().jukeboxAudioMode).toBe("daycore");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("daycore");
    expect(context.cowbellOverlay.setSectionStartBeatIndices).toHaveBeenCalledWith([
      4,
      12,
    ]);
    expect(useAppStore.getState().tuningParams).toContain("am=daycore");
  });

  it("opens tuning modal on extras tab", () => {
    useAppStore.setState({ tuningModalOpen: false, tuningModalTab: "tuning" });
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });

    openExtras(context);

    expect(useAppStore.getState().tuningModalOpen).toBe(true);
    expect(useAppStore.getState().tuningModalTab).toBe("extras");
  });

  it("falls back to the tuning tab when mode does not support extras", () => {
    useAppStore.setState({ tuningModalOpen: false, tuningModalTab: "tuning" });
    const context = createContext();
    useAppStore.setState({ playMode: "autocanonizer" });

    openExtras(context);

    expect(useAppStore.getState().tuningModalOpen).toBe(true);
    expect(useAppStore.getState().tuningModalTab).toBe("tuning");
  });

  it("applies tuning params and deleted edges from url together", () => {
    setWindowUrl("http://localhost/listen/abc?thresh=20&d=2");
    const graph = {
      currentThreshold: 45,
      allEdges: [
        { id: 2, deleted: false },
        { id: 3, deleted: false },
      ],
      totalBeats: 0,
    };
    const updateConfig = vi.fn();
    const deleteEdge = vi.fn((edge: { deleted: boolean }) => {
      edge.deleted = true;
    });
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.02,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig,
        loadAnalysis: vi.fn(),
        getSectionStartBeatIndices: vi.fn(() => []),
        getGraphState: vi.fn(() => graph),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge,
        rebuildGraph: vi.fn(),
      } as unknown as AppContext["engine"],
    });

    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: {} },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ currentThreshold: 20 }),
    );
    expect(deleteEdge).toHaveBeenCalledTimes(1);
    expect(graph.allEdges[0].deleted).toBe(true);
    expect(useAppStore.getState().deletedEdgeIds).toEqual([2]);
  });
});

describe("playback timers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setupSleepTimerClock(initialNowMs = 1000) {
    let nowMs = initialNowMs;
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    (globalThis.window as unknown as { setTimeout: typeof setTimeout }).setTimeout =
      setTimeout;
    (globalThis.window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
      clearTimeout;
    vi.stubGlobal("document", { fullscreenElement: null });
    return {
      setNow(nextNowMs: number) {
        nowMs = nextNowMs;
      },
    };
  }

  it("updates listen time display", () => {
    createContext();
    useAppStore.setState({ playTimerMs: 1000 });
    useAppStore.setState({ lastPlayStamp: 0 });
    vi.spyOn(performance, "now").mockReturnValue(1000);
    updateListenTimeDisplay();
    expect(useAppStore.getState().listenTimeText).toBe("00:00:02");
  });

  it("maps null, zero, negative, and unknown sleep timer durations to off", () => {
    setupSleepTimerClock();
    createContext();

    for (const durationMs of [null, 0, -1, Number.NaN]) {
      setSleepTimer(30 * 60 * 1000);
      setSleepTimer(durationMs);

      expect(useAppStore.getState().sleepTimer).toEqual({
        configuredDurationMs: null,
        endTimeMs: null,
        remainingMs: 0,
      });
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("sets sleep timer state from monotonic time", () => {
    setupSleepTimerClock(5000);
    createContext();

    setSleepTimer(15 * 60 * 1000);

    expect(useAppStore.getState().sleepTimer).toEqual({
      configuredDurationMs: 15 * 60 * 1000,
      endTimeMs: 905000,
      remainingMs: 15 * 60 * 1000,
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("replacing a sleep timer cancels the old expiry", () => {
    const clock = setupSleepTimerClock(1000);
    const context = createContext();
    useAppStore.setState({ isRunning: true });

    setSleepTimer(1000);
    setSleepTimer(5000);
    clock.setNow(2000);
    vi.advanceTimersByTime(1000);

    expect(context.engine.stopJukebox).not.toHaveBeenCalled();
    expect(useAppStore.getState().sleepTimer.configuredDurationMs).toBe(5000);
    expect(useAppStore.getState().sleepTimer.remainingMs).toBe(4000);
  });

  it("expires by clearing timer state, stopping playback, and exiting fullscreen", () => {
    const clock = setupSleepTimerClock(1000);
    const exitFullscreen = vi.fn(async () => undefined);
    vi.stubGlobal("document", {
      fullscreenElement: {},
      exitFullscreen,
    });
    const context = createContext();
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({ isPaused: false });
    useAppStore.setState({ playTimerMs: 1234 });
    useAppStore.setState({ beatsPlayedText: "8" });

    setSleepTimer(1000);
    clock.setNow(2000);
    vi.advanceTimersByTime(1000);

    expect(useAppStore.getState().sleepTimer).toEqual({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
    expect(useAppStore.getState().isRunning).toBe(false);
    expect(useAppStore.getState().isPaused).toBe(false);
    expect(context.engine.stopJukebox).toHaveBeenCalled();
    expect(useAppStore.getState().beatsPlayedText).toBe("0");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("schedules the final partial second without waiting a full extra tick", () => {
    const clock = setupSleepTimerClock(1000);
    const context = createContext();
    useAppStore.setState({ isRunning: true });

    setSleepTimer(1500);
    clock.setNow(2000);
    vi.advanceTimersByTime(1000);

    expect(useAppStore.getState().sleepTimer.remainingMs).toBe(500);
    expect(context.engine.stopJukebox).not.toHaveBeenCalled();

    clock.setNow(2499);
    vi.advanceTimersByTime(499);
    expect(context.engine.stopJukebox).not.toHaveBeenCalled();

    clock.setNow(2500);
    vi.advanceTimersByTime(1);
    expect(context.engine.stopJukebox).toHaveBeenCalled();
  });
});

describe("playback controls", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/listen/abc");
    vi.stubGlobal("document", { fullscreenElement: null });
    (globalThis.window as unknown as { setInterval: typeof setInterval }).setInterval =
      setInterval;
    (globalThis.window as unknown as { clearInterval: typeof clearInterval }).clearInterval =
      clearInterval;
    (globalThis.window as unknown as { setTimeout: typeof setTimeout }).setTimeout =
      setTimeout;
    (globalThis.window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
      clearTimeout;
  });

  it("pauses and resumes without resetting when already started", () => {
    const context = createContext();
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ analysisLoaded: true });
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    togglePlayback(context);

    expect(context.engine.resetStats).toHaveBeenCalledTimes(1);
    expect(context.engine.startJukebox).toHaveBeenCalledWith(true);
    expect(useAppStore.getState().isRunning).toBe(true);
    expect(useAppStore.getState().isPaused).toBe(false);

    togglePlayback(context);

    expect(context.engine.pauseJukebox).toHaveBeenCalledTimes(1);
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().isRunning).toBe(false);
    expect(useAppStore.getState().isPaused).toBe(true);

    togglePlayback(context);

    expect(context.engine.resetStats).toHaveBeenCalledTimes(1);
    expect(context.engine.startJukebox).toHaveBeenLastCalledWith(false);
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().isRunning).toBe(true);
    expect(useAppStore.getState().isPaused).toBe(false);
  });

  it("blocks jukebox playback while swing mode is preparing", () => {
    const context = createContext();
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ analysisLoaded: true });
    useAppStore.setState({ jukeboxAudioMode: "swing" });
    useAppStore.setState({ swingPreparing: true });
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    togglePlayback(context);

    expect(context.engine.play).not.toHaveBeenCalled();
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
    expect(useAppStore.getState().isRunning).toBe(false);
  });

  it("shows only loading status panel while swing mode is preparing", () => {
    createContext();
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ analysisLoaded: true });
    useAppStore.setState({ jukeboxAudioMode: "swing" });
    useAppStore.setState({ swingPreparing: true });

    updateVizVisibility();
  });

  it("blocks beat-start playback while swing mode is preparing", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ jukeboxAudioMode: "swing" });
    useAppStore.setState({ swingPreparing: true });
    useAppStore.setState({
      vizData: {
      beats: [{ start: 2, duration: 1 }],
      edges: [],
    } as unknown as AppState["vizData"]
    });
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    startJukeboxFromBeat(context, 0);

    expect(context.player.seek).not.toHaveBeenCalled();
    expect(context.engine.seekToBeat).not.toHaveBeenCalled();
    expect(context.engine.play).not.toHaveBeenCalled();
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
  });

  it("stop clears paused state and forces next play to restart", () => {
    const context = createContext();
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ analysisLoaded: true });
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    togglePlayback(context);
    togglePlayback(context);
    useAppStore.setState({ playTimerMs: 12345 });
    useAppStore.setState({ lastBeatIndex: 7 });
    useAppStore.setState({ beatsPlayedText: "7" });
    stopPlayback(context);

    expect(useAppStore.getState().isPaused).toBe(false);
    expect(useAppStore.getState().isRunning).toBe(false);
    expect(useAppStore.getState().playTimerMs).toBe(0);
    expect(useAppStore.getState().lastBeatIndex).toBe(null);
    expect(useAppStore.getState().beatsPlayedText).toBe("0");
    expect(context.engine.stopJukebox).toHaveBeenCalled();
    expect(context.engine.resetStats).toHaveBeenCalled();
    expect(context.jukebox.reset).toHaveBeenCalled();

    togglePlayback(context);

    expect(context.engine.resetStats).toHaveBeenCalledTimes(3);
    expect(context.engine.startJukebox).toHaveBeenLastCalledWith(true);
  });

  it("resumes audio output when selecting a beat while session is running", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({
      vizData: {
      beats: [{ start: 0, duration: 1 }],
      edges: [],
    } as unknown as AppState["vizData"]
    });
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);
    (context.player.isPlaying as ReturnType<typeof vi.fn>).mockReturnValue(false);

    startJukeboxFromBeat(context, 0);

    expect(context.player.seek).toHaveBeenCalledWith(0);
    expect(context.engine.seekToBeat).toHaveBeenCalledWith(0);
    expect(context.engine.play).toHaveBeenCalledTimes(1);
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
  });

  it("does not replay when selecting a beat while already actively playing", () => {
    const context = createContext();
    useAppStore.setState({ playMode: "jukebox" });
    useAppStore.setState({ isRunning: true });
    useAppStore.setState({
      vizData: {
      beats: [{ start: 2, duration: 1 }],
      edges: [],
    } as unknown as AppState["vizData"]
    });
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);
    (context.player.isPlaying as ReturnType<typeof vi.fn>).mockReturnValue(true);

    startJukeboxFromBeat(context, 0);

    expect(context.player.seek).toHaveBeenCalledWith(2);
    expect(context.engine.seekToBeat).toHaveBeenCalledWith(0);
    expect(context.engine.play).not.toHaveBeenCalled();
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
  });

  it("draws the promoted jump target before moving a caught-up cursor", () => {
    const context = createContext();
    useAppStore.setState({ lastBeatIndex: 9 });

    initializePlayback();
    const onUpdate = context.engine.onUpdate as ReturnType<typeof vi.fn>;
    const listener = onUpdate.mock.calls[0]?.[0] as
      | ((state: {
          beatsPlayed: number;
          currentBeatIndex: number;
          currentTime: number;
          lastJumped: boolean;
          lastJumpTime: number | null;
          lastJumpFromIndex: number | null;
          lastJumpToIndex: number | null;
          currentThreshold: number;
          lastBranchPoint: number;
          curRandomBranchChance: number;
        }) => void)
      | undefined;

    listener?.({
      beatsPlayed: 12,
      currentBeatIndex: 2,
      currentTime: 1.2,
      lastJumped: true,
      lastJumpTime: 0,
      lastJumpFromIndex: 1,
      lastJumpToIndex: 0,
      currentThreshold: 20,
      lastBranchPoint: 1,
      curRandomBranchChance: 0.2,
    });

    expect(context.jukebox.update).toHaveBeenNthCalledWith(1, 0, true, 1);
    expect(context.jukebox.update).toHaveBeenNthCalledWith(2, 2, false, 0);
    expect(useAppStore.getState().lastBeatIndex).toBe(2);
  });
});

describe("playback branch shortcuts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setWindowUrl("http://localhost/listen/abc");
  });

  function makeHandlers(context: AppContext) {
    resetPlaybackUiForTest();
    setAppRuntime(context);
    return {
      handlers: { handleEdgeSelect, handleKeydown, handleKeyup },
      // `showToast` (./ui) and `syncDeletedEdgeState` (./playback) are module
      // mocks; the handlers call the same instances we assert on here.
      showToast: vi.mocked(showToast),
      syncDeletedEdgeState: vi.mocked(syncDeletedEdgeState),
    };
  }

  function keyEvent(key: string) {
    return {
      key,
      repeat: false,
      target: null,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
  }

  it("sets and clears the selected backward branch as the user anchor", () => {
    const context = createContext();
    const edge = {
      id: 7,
      src: { which: 8 },
      dest: { which: 2 },
      deleted: false,
    };
    useAppStore.setState({ selectedEdge: edge as AppState["selectedEdge"] });
    useAppStore.setState({
      vizData: {
      beats: [],
      edges: [edge],
      lastBranchPoint: 1,
      anchorEdgeId: null,
    } as unknown as AppState["vizData"]
    });
    const nextVizData = {
      beats: [],
      edges: [edge],
      lastBranchPoint: 1,
      anchorEdgeId: 7,
    };
    (
      context.engine.getVisualizationData as ReturnType<typeof vi.fn>
    ).mockReturnValue(nextVizData);
    const { handlers, showToast } = makeHandlers(context);
    const setEvent = keyEvent("A");

    handlers.handleKeydown(setEvent);

    expect(setEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.engine.setUserAnchorEdge).toHaveBeenCalledWith(edge);
    expect(context.jukebox.setData).toHaveBeenCalledWith(nextVizData);
    expect(context.jukebox.setSelectedEdgeActive).toHaveBeenCalledWith(edge);
    expect(showToast).toHaveBeenCalledWith("Anchor branch set");
    // The folded writeTuningParamsToUrl runs for real; assert the serialized
    // anchor it persists to the store (and thus the URL).
    expect(useAppStore.getState().tuningParams).toBe("ab=7");
    expect(window.location.search).toBe("?ab=7");

    const resetEvent = keyEvent("a");
    handlers.handleKeydown(resetEvent);

    expect(resetEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.engine.setUserAnchorEdge).toHaveBeenLastCalledWith(null);
    expect(showToast).toHaveBeenLastCalledWith("Anchor branch reset");
    expect(useAppStore.getState().tuningParams).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("ignores A for a selected forward branch", () => {
    const context = createContext();
    const edge = {
      id: 8,
      src: { which: 2 },
      dest: { which: 5 },
      deleted: false,
    };
    useAppStore.setState({ selectedEdge: edge as AppState["selectedEdge"] });
    const { handlers } = makeHandlers(context);
    const event = keyEvent("A");

    handlers.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.engine.setUserAnchorEdge).not.toHaveBeenCalled();
  });

  it("ignores playback shortcuts while track delete confirmation is open", () => {
    useAppStore.setState({ deleteConfirmOpen: true });
    const context = createContext();
    useAppStore.setState({
      selectedEdge: {
      id: 9,
      src: { which: 8 },
      dest: { which: 2 },
      deleted: false,
    } as AppState["selectedEdge"]
    });
    const { handlers } = makeHandlers(context);
    const event = keyEvent("Delete");

    handlers.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.engine.deleteEdge).not.toHaveBeenCalled();
    useAppStore.setState({ deleteConfirmOpen: false });
  });

  it("shows branch stats and enables delete for a selected active branch", () => {
    const context = createContext();
    useAppStore.setState({ branchStatsEnabled: true });
    const edge = {
      id: 12,
      src: { which: 8, start: 32 },
      dest: { which: 2, start: 8 },
      distance: 20,
      deleted: false,
    };
    const { handlers } = makeHandlers(context);

    handlers.handleEdgeSelect(edge as AppState["selectedEdge"]);

    expect(useAppStore.getState().selectedEdge).toBe(edge);
    expect(context.jukebox.setSelectedEdgeActive).toHaveBeenCalledWith(edge);
    expect(useAppStore.getState().branchStats).toEqual({
      title: "Branch #12 stats",
      startText: "00:00:32",
      endText: "00:00:08",
      deltaText: "-00:00:24",
      direction: "Backward",
      similarityText: "75%",
      deleteDisabled: false,
    });
  });

  it("hides branch stats and disables delete for a deleted selected branch", () => {
    const context = createContext();
    useAppStore.setState({ branchStatsEnabled: true });
    const edge = {
      id: 13,
      src: { which: 8, start: 32 },
      dest: { which: 2, start: 8 },
      distance: 20,
      deleted: true,
    };
    const { handlers } = makeHandlers(context);

    handlers.handleEdgeSelect(edge as AppState["selectedEdge"]);

    expect(useAppStore.getState().branchStats?.deleteDisabled).toBe(true);
  });

  function branchEdge(id: number, deleted = false) {
    return { id, src: { which: id }, dest: { which: 0 }, deleted };
  }

  function setBranchState(
    edges: ReturnType<typeof branchEdge>[],
    selectedId: number | null,
  ) {
    const selected = edges.find((edge) => edge.id === selectedId) ?? null;
    useAppStore.setState({
      playMode: "jukebox",
      deleteConfirmOpen: false,
      selectedEdge: selected as AppState["selectedEdge"],
      vizData: {
        beats: [],
        edges,
        lastBranchPoint: 1,
        anchorEdgeId: null,
      } as unknown as AppState["vizData"],
    });
  }

  it("cycles to the next branch on ArrowRight and wraps around", () => {
    const context = createContext();
    const edges = [branchEdge(1), branchEdge(2), branchEdge(3)];
    setBranchState(edges, 3);
    const { handlers } = makeHandlers(context);
    const event = keyEvent("ArrowRight");

    handlers.handleKeydown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    // From the last edge, wrap around to the first.
    expect(useAppStore.getState().selectedEdge?.id).toBe(1);
    expect(context.jukebox.setSelectedEdgeActive).toHaveBeenLastCalledWith(
      edges[0],
    );
  });

  it("cycles to the previous branch on ArrowLeft and wraps around", () => {
    const context = createContext();
    const edges = [branchEdge(1), branchEdge(2), branchEdge(3)];
    setBranchState(edges, 1);
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("ArrowLeft"));

    // From the first edge, wrap around to the last.
    expect(useAppStore.getState().selectedEdge?.id).toBe(3);
  });

  it("skips deleted edges when cycling branches", () => {
    const context = createContext();
    const edges = [branchEdge(1), branchEdge(2, true), branchEdge(3)];
    setBranchState(edges, 1);
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("ArrowRight"));

    // Edge 2 is deleted and filtered out, so next after 1 is 3.
    expect(useAppStore.getState().selectedEdge?.id).toBe(3);
  });

  it("ignores arrow keys when no branch is selected", () => {
    const context = createContext();
    setBranchState([branchEdge(1)], null);
    const { handlers } = makeHandlers(context);
    const event = keyEvent("ArrowRight");

    handlers.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.jukebox.setSelectedEdgeActive).not.toHaveBeenCalled();
  });

  it("deletes the selected branch on Delete and syncs deleted-edge URL state", () => {
    const context = createContext();
    const edge = branchEdge(5);
    setBranchState([edge], 5);
    const { handlers, syncDeletedEdgeState } = makeHandlers(context);
    const event = keyEvent("Delete");

    handlers.handleKeydown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.engine.deleteEdge).toHaveBeenCalledWith(edge);
    expect(context.engine.rebuildGraph).toHaveBeenCalledTimes(1);
    expect(syncDeletedEdgeState).toHaveBeenCalledWith(context);
    expect(useAppStore.getState().selectedEdge).toBeNull();
    expect(context.jukebox.setSelectedEdge).toHaveBeenLastCalledWith(null);
  });

  it("removes the selected branch on Backspace too", () => {
    const context = createContext();
    const edge = branchEdge(6);
    setBranchState([edge], 6);
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("Backspace"));

    expect(context.engine.deleteEdge).toHaveBeenCalledWith(edge);
  });

  it("ignores Delete for an already-deleted branch", () => {
    const context = createContext();
    const edge = branchEdge(7, true);
    setBranchState([edge], 7);
    const { handlers } = makeHandlers(context);
    const event = keyEvent("Delete");

    handlers.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.engine.deleteEdge).not.toHaveBeenCalled();
  });

  it("force-branches while Shift is held during playback and clears on release", () => {
    const context = createContext();
    useAppStore.setState({
      playMode: "jukebox",
      deleteConfirmOpen: false,
      isRunning: true,
      shiftBranching: false,
      bringItHomeMode: false,
    });
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("Shift"));
    expect(useAppStore.getState().shiftBranching).toBe(true);
    expect(context.engine.setForceBranch).toHaveBeenLastCalledWith(true);

    handlers.handleKeyup(keyEvent("Shift"));
    expect(useAppStore.getState().shiftBranching).toBe(false);
    expect(context.engine.setForceBranch).toHaveBeenLastCalledWith(false);
  });

  it("suppresses Shift force-branching while Bring It Home is on", () => {
    const context = createContext();
    useAppStore.setState({
      playMode: "jukebox",
      deleteConfirmOpen: false,
      isRunning: true,
      shiftBranching: false,
      bringItHomeMode: true,
    });
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("Shift"));

    expect(useAppStore.getState().shiftBranching).toBe(false);
    expect(context.engine.setForceBranch).not.toHaveBeenCalledWith(true);
  });

  it("does not force-branch on Shift while paused", () => {
    const context = createContext();
    useAppStore.setState({
      playMode: "jukebox",
      deleteConfirmOpen: false,
      isRunning: false,
      shiftBranching: false,
      bringItHomeMode: false,
    });
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("Shift"));

    expect(useAppStore.getState().shiftBranching).toBe(false);
    expect(context.engine.setForceBranch).not.toHaveBeenCalledWith(true);
  });

  it("clears active force-branching when Bring It Home is toggled on via hotkey", () => {
    const context = createContext();
    useAppStore.setState({
      playMode: "jukebox",
      deleteConfirmOpen: false,
      isRunning: true,
      shiftBranching: true,
      bringItHomeMode: false,
    });
    const { handlers } = makeHandlers(context);

    handlers.handleKeydown(keyEvent("h"));

    expect(useAppStore.getState().bringItHomeMode).toBe(true);
    expect(useAppStore.getState().shiftBranching).toBe(false);
    expect(context.engine.setBringItHomeMode).toHaveBeenCalledWith(true);
    expect(context.engine.setForceBranch).toHaveBeenLastCalledWith(false);
  });
});

describe("playback loading", () => {
  function createLoadDeps() {
    return {
      setActiveTab: vi.fn(),
      navigateToTab: vi.fn(),
      updateTrackUrl: vi.fn(),
      setAnalysisStatus: vi.fn(),
      setLoadingProgress: vi.fn(),
      onTrackChange: vi.fn(),
      onPlaylistChange: vi.fn(),
    };
  }

  it("loads bare track ids as YouTube sources", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    const deps = createLoadDeps();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "failed",
        id: jobId,
        source_id: "abc123def45",
        source_provider: "youtube",
      }),
    } as Response);

    await loadTrackById(context, deps, "abc123def45");

    expect(useAppStore.getState().lastTrackId).toBe(jobId);
    expect(useAppStore.getState().lastJobId).toBe(jobId);
    expect(useAppStore.getState().lastSourceProvider).toBe("youtube");
    expect(deps.onTrackChange).toHaveBeenCalledWith(jobId);
    expect(deps.updateTrackUrl).toHaveBeenCalledWith(jobId, true);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/jobs/by-source/youtube/abc123def45",
    );
  });

  it("loads 32-character hex track ids as jobs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    const deps = createLoadDeps();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";

    await loadTrackById(context, deps, jobId);

    expect(useAppStore.getState().lastTrackId).toBe(jobId);
    expect(useAppStore.getState().lastJobId).toBe(jobId);
    expect(useAppStore.getState().lastSourceProvider).toBeNull();
    expect(deps.onTrackChange).toHaveBeenCalledWith(jobId);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      `/api/analysis/${jobId}`,
    );
  });

  it("retries a failed job once through the generic POST flow", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "failed",
          id: jobId,
          source_provider: "soundcloud",
          error: "ERROR: Unable to download video data.",
          error_code: "download_unavailable",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: "downloading",
          id: jobId,
          source_provider: "soundcloud",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "failed",
          id: jobId,
          source_provider: "soundcloud",
          error: "ERROR: Unable to download video data.",
          error_code: "download_unavailable",
        }),
      } as Response);

    await loadTrackById(context, deps, jobId);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/analysis/${jobId}`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/jobs/${jobId}/retry`);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/analysis/${jobId}`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(deps.setAnalysisStatus).toHaveBeenLastCalledWith(
      "SoundCloud fetch failed.",
      false,
    );
  });

  it("lets the backend reject a non-retryable job restart", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    const jobId = "b3f3c0dc73c6476c9db95c227f9206f2";
    const failedResponse = {
      status: "failed",
      id: jobId,
      source_id: "abc123def45",
      source_provider: "youtube",
      error: "ERROR: No beats or downbeats were detected in this audio.",
      error_code: "no_beats_detected",
    };
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => failedResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => failedResponse,
      } as Response);

    await loadTrackById(context, deps, jobId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/jobs/${jobId}/retry`);
    expect(deps.setAnalysisStatus).toHaveBeenLastCalledWith(
      "No beats or downbeats were detected in this audio.",
      false,
    );
  });

  it("retries a failed job without exposing source metadata", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    const jobId = "c3f3c0dc73c6476c9db95c227f9206f2";
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const failedResponse = {
      status: "failed",
      id: jobId,
      error: "Engine exited with status 1",
      error_code: "engine_error",
    };
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => failedResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => failedResponse,
      } as Response);

    await loadTrackById(context, deps, jobId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/jobs/${jobId}/retry`);
    expect(deps.setAnalysisStatus).toHaveBeenLastCalledWith(
      "Engine exited with status 1",
      false,
    );
  });

  it("marks the matching saved playlist item current on preserved route loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    useAppStore.setState({
      playlist: {
      tracks: [
        {
          id: "first",
          sourceType: "youtube",
          title: "First",
          artist: "",
          duration: null,
        },
        {
          id: "sc-123",
          sourceType: "soundcloud",
          title: "SoundCloud Track",
          artist: "",
          duration: null,
        },
      ],
      currentIndex: -1,
    }
    });
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "soundcloud:sc-123", {
      preservePlaylist: true,
    });

    expect(useAppStore.getState().playlist.currentIndex).toBe(1);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("appends missing route-loaded tracks to saved playlists", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    useAppStore.setState({
      playlist: {
      tracks: [
        {
          id: "saved-a",
          sourceType: "youtube",
          title: "Saved A",
          artist: "",
          duration: null,
        },
        {
          id: "saved-b",
          sourceType: "youtube",
          title: "Saved B",
          artist: "",
          duration: null,
        },
      ],
      currentIndex: -1,
    }
    });
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside", {
      preservePlaylist: true,
    });

    expect(useAppStore.getState().playlist.currentIndex).toBe(2);
    expect(useAppStore.getState().playlist.tracks.map((track) => track.id)).toEqual([
      "saved-a",
      "saved-b",
      "outside",
    ]);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
    expect(localStorage.getItem("fj-playlist")).toContain("outside");
  });

  it("replaces the final saved playlist slot for missing route-loaded tracks when full", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    useAppStore.setState({
      playlist: {
      tracks: Array.from({ length: 10 }, (_, index) => ({
        id: `saved-${index}`,
        sourceType: "youtube" as const,
        title: `Saved ${index}`,
        artist: "",
        duration: null,
      })),
      currentIndex: -1,
    }
    });
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside", {
      preservePlaylist: true,
    });

    expect(useAppStore.getState().playlist.currentIndex).toBe(9);
    expect(useAppStore.getState().playlist.tracks).toHaveLength(10);
    expect(useAppStore.getState().playlist.tracks[9]?.id).toBe("outside");
    expect(useAppStore.getState().playlist.tracks[8]?.id).toBe("saved-8");
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("replaces only the current active playlist item on normal track loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    useAppStore.setState({
      playlist: {
      tracks: [
        {
          id: "current",
          sourceType: "youtube",
          title: "Current",
          artist: "",
          duration: null,
        },
        {
          id: "next",
          sourceType: "youtube",
          title: "Next",
          artist: "",
          duration: null,
        },
      ],
      currentIndex: 0,
    }
    });
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside", {
      selectedTrack: {
        id: "outside",
        sourceType: "youtube",
        title: "Outside",
        artist: "",
        duration: null,
      },
    });

    expect(useAppStore.getState().playlist.currentIndex).toBe(0);
    expect(useAppStore.getState().playlist.tracks.map((track) => track.id)).toEqual([
      "outside",
      "next",
    ]);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("clears inactive saved playlists on normal track loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    useAppStore.setState({
      playlist: {
      tracks: [
        {
          id: "saved-a",
          sourceType: "youtube",
          title: "Saved A",
          artist: "",
          duration: null,
        },
        {
          id: "saved-b",
          sourceType: "youtube",
          title: "Saved B",
          artist: "",
          duration: null,
        },
      ],
      currentIndex: -1,
    }
    });
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside");

    expect(useAppStore.getState().playlist.tracks).toEqual([]);
    expect(useAppStore.getState().playlist.currentIndex).toBe(-1);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("returns false on missing audio without calling repair endpoint", async () => {
    const context = createContext();
    useAppStore.setState({ audioLoadInFlight: true });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const loaded = await loadAudioFromJob(context, "upload-job");

    expect(loaded).toBe(false);
    expect(useAppStore.getState().audioLoadInFlight).toBe(false);
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe("/api/audio/upload-job");
    expect(calls.some((call) => String(call[0]).includes("/api/repair/"))).toBe(
      false,
    );
  });

  it("loads audio before applying a complete polled analysis", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    const audioBuffer = new ArrayBuffer(4);
    const decodedBuffer = { duration: 12 } as AudioBuffer;
    context.player = {
      ...context.player,
      decode: vi.fn(async () => undefined),
      getBuffer: vi.fn(() => decodedBuffer),
      getContext: vi.fn(() => ({} as BaseAudioContext)),
    } as unknown as AppContext["player"];
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "complete",
          id: "job-complete",
          result: {
            sections: [],
            bars: [],
            beats: [],
            tatums: [],
            segments: [],
            track: { title: "Loaded", duration: 12 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => audioBuffer,
      } as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

    await pollAnalysis(context, deps, "job-complete");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/analysis/job-complete",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/audio/job-complete", {
      signal: undefined,
    });
    expect(context.player.decode).toHaveBeenCalledWith(audioBuffer);
    expect(context.engine.loadAnalysis).toHaveBeenCalled();
    expect(useAppStore.getState().audioLoaded).toBe(true);
    expect(useAppStore.getState().analysisLoaded).toBe(true);
    expect(deps.setLoadingProgress).toHaveBeenCalledWith(100, "Calculating pathways");
    expect(deps.setActiveTab).toHaveBeenCalledWith("play");
  });

  it("shows a generic load error when polling returns missing analysis", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    await pollAnalysis(context, deps, "missing-job");

    expect(deps.setAnalysisStatus).toHaveBeenCalledWith(
      "Something went wrong. Please try again or report an issue on GitHub.",
      false,
    );
    expect(context.engine.loadAnalysis).not.toHaveBeenCalled();
  });

  it("discards a superseded audio download (no decode, no publish)", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    context.player = {
      ...context.player,
      decode: vi.fn(async () => undefined),
      getBuffer: vi.fn(() => ({ duration: 12 }) as AudioBuffer),
      getContext: vi.fn(() => ({}) as BaseAudioContext),
    } as unknown as AppContext["player"];
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "complete",
          id: "job-superseded",
          result: {
            sections: [],
            bars: [],
            beats: [],
            tatums: [],
            segments: [],
            track: { title: "Old", duration: 12 },
          },
        }),
      } as Response)
      // the audio download resolves only after a newer load has started
      .mockImplementationOnce(async () => {
        resetForNewTrack(context);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(8),
        } as unknown as Response;
      });

    await pollAnalysis(context, deps, "job-superseded");

    expect(context.player.decode).not.toHaveBeenCalled();
    expect(context.engine.loadAnalysis).not.toHaveBeenCalled();
    expect(useAppStore.getState().audioLoaded).toBe(false);
    expect(deps.setActiveTab).not.toHaveBeenCalledWith("play");
  });

  it("stops a poll iteration when a newer load supersedes it mid-await", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    useAppStore.setState({ audioLoaded: true });
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      // a newer track load lands while the status request is in flight
      resetForNewTrack(context);
      useAppStore.setState({ audioLoaded: true });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "complete",
          id: "job-late",
          result: {
            sections: [],
            bars: [],
            beats: [],
            tatums: [],
            segments: [],
            track: { title: "Late", duration: 9 },
          },
        }),
      } as unknown as Response;
    });

    await pollAnalysis(context, deps, "job-late");

    // the stale iteration must not apply its analysis over the newer track
    expect(context.engine.loadAnalysis).not.toHaveBeenCalled();
    expect(deps.setActiveTab).not.toHaveBeenCalledWith("play");
  });

  it("exits silently when the poll is cancelled mid-request", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      // a newer track load cancels this poll while its request is in flight
      cancelPoll();
      const err = new Error("signal is aborted without reason");
      err.name = "AbortError";
      throw err;
    });

    await pollAnalysis(context, deps, "job-cancelled");

    expect(deps.setAnalysisStatus).not.toHaveBeenCalled();
    expect(context.engine.loadAnalysis).not.toHaveBeenCalled();
    expect(useAppStore.getState().analysisPollInFlight).toBe(false);
  });

  it("surfaces failed analysis status without applying stale analysis", async () => {
    const context = createContext();
    const deps = createLoadDeps();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "failed",
        id: "job-failed",
        source_provider: "youtube",
        error_code: "download_unavailable",
        error: "ERROR: [download] This video is not available.",
      }),
    } as Response);

    await pollAnalysis(context, deps, "job-failed");

    expect(deps.setAnalysisStatus).toHaveBeenCalledWith(
      "YouTube fetch failed.",
      false,
    );
    expect(context.engine.loadAnalysis).not.toHaveBeenCalled();
    expect(useAppStore.getState().analysisLoaded).toBe(false);
  });
});
