import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { AnalysisComplete } from "./api";
import {
  applyAnalysisResult,
  applyTuningChanges,
  syncTuningUI,
  updateListenTimeDisplay,
} from "./playback";
import { setWindowUrl } from "./__tests__/test-utils";

function createClassList() {
  return {
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    contains: vi.fn().mockReturnValue(false),
  };
}

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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true }) as Response),
  );
  setLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createInput(initial = "") {
  return { value: initial, checked: false } as HTMLInputElement;
}

function createSpan() {
  return { textContent: "" } as HTMLSpanElement;
}

function createElements() {
  return {
    thresholdInput: createInput("0"),
    thresholdVal: createSpan(),
    computedThresholdEl: createSpan(),
    minProbInput: createInput("0"),
    minProbVal: createSpan(),
    maxProbInput: createInput("0"),
    maxProbVal: createSpan(),
    rampInput: createInput("0"),
    rampVal: createSpan(),
    volumeInput: createInput("50"),
    volumeVal: createSpan(),
    justBackwardsInput: createInput(),
    justLongInput: createInput(),
    removeSeqInput: createInput(),
    highlightAnchorBranchInput: createInput(),
    tuningModal: { classList: createClassList() },
    infoModal: { classList: createClassList() },
    listenTimeEl: createSpan(),
    playStatusPanel: { classList: createClassList() },
    playMenu: { classList: createClassList() },
    vizPanel: { classList: createClassList() },
    playButton: { classList: createClassList(), disabled: false },
    playTabButton: { classList: createClassList(), disabled: false },
    vizSelect: { disabled: false, value: "0" },
    canonizerFinish: { checked: false, addEventListener: vi.fn() },
    playTitle: createSpan(),
    vizNowPlayingEl: createSpan(),
    infoDurationEl: createSpan(),
    infoBeatsEl: createSpan(),
    infoBranchesEl: createSpan(),
    infoDeletedBranchesEl: createSpan(),
    deleteButton: { classList: createClassList() },
  };
}

function createContext(overrides?: Partial<AppContext>): AppContext {
  const elements = createElements();
  const engineConfig = {
    currentThreshold: 0,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.1,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
  };
  const engine = {
    getConfig: vi.fn(() => ({ ...engineConfig })),
    updateConfig: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(engineConfig, partial);
    }),
    rebuildGraph: vi.fn(),
    getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
    getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
  };
  const player = {
    getVolume: vi.fn(() => 0.5),
    getDuration: vi.fn(() => null),
    stop: vi.fn(),
  };
  const autocanonizer = {
    setAnalysis: vi.fn(),
    setAudio: vi.fn(),
    setVolume: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    isReady: vi.fn(() => false),
    setOnBeat: vi.fn(),
    setOnEnded: vi.fn(),
    setVisible: vi.fn(),
    resizeNow: vi.fn(),
  };
  const jukebox = {
    setData: vi.fn(),
    setAnchorHighlightEnabled: vi.fn(),
    setSelectedEdge: vi.fn(),
    resizeActive: vi.fn(),
    reset: vi.fn(),
    update: vi.fn(),
  };
  return {
    elements: elements as unknown as AppContext["elements"],
    engine: engine as unknown as AppContext["engine"],
    player: player as unknown as AppContext["player"],
    autocanonizer: autocanonizer as unknown as AppContext["autocanonizer"],
    jukebox: jukebox as unknown as AppContext["jukebox"],
    defaultConfig: engineConfig as unknown as AppContext["defaultConfig"],
    state: {
      playMode: "jukebox",
      autoComputedThreshold: null,
      vizData: null,
      playTimerMs: 0,
      lastPlayStamp: null,
      audioLoaded: false,
      analysisLoaded: false,
      audioLoadInFlight: false,
      activeTabId: "play",
      activeVizIndex: 0,
      lastYouTubeId: null,
      lastJobId: null,
      isRunning: false,
      trackDurationSec: null,
      trackTitle: null,
      trackArtist: null,
      selectedEdge: null,
      deleteEligible: false,
      deleteEligibilityJobId: null,
      shiftBranching: false,
      lastBeatIndex: null,
      listenTimerId: null,
      pollController: null,
      wakeLock: null,
      favorites: [],
      favoritesSyncCode: null,
      topSongsTab: "top",
      searchTab: "search",
      topSongsRefreshTimer: null,
      toastTimer: null,
      pendingAutoFavoriteId: null,
      lastPlayCountedJobId: null,
      appConfig: null,
      tuningParams: null,
      deletedEdgeIds: [],
      highlightAnchorBranch: false,
      beatsPlayed: 0,
    } as unknown as AppContext["state"],
    ...overrides,
  };
}

describe("playback tuning", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setWindowUrl("http://localhost/listen/abc");
  });

  it("syncs tuning UI from config and graph", () => {
    const context = createContext();
    context.state.highlightAnchorBranch = true;
    syncTuningUI(context);
    expect(context.elements.thresholdInput.value).toBe("45");
    expect(context.elements.thresholdVal.textContent).toBe("45");
    expect(context.elements.volumeVal.textContent).toBe("50");
    expect(context.elements.highlightAnchorBranchInput.checked).toBe(true);
    expect(context.elements.computedThresholdEl.textContent).toBe("45");
  });

  it("applies tuning changes and normalizes min/max", () => {
    const context = createContext();
    context.elements.minProbInput.value = "80";
    context.elements.maxProbInput.value = "10";
    context.elements.rampInput.value = "10";
    context.elements.thresholdInput.value = "50";
    context.elements.computedThresholdEl.textContent = "50";
    applyTuningChanges(context);
    expect(context.elements.minProbInput.value).toBe("10");
    expect(context.elements.maxProbInput.value).toBe("80");
    expect(context.engine.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        currentThreshold: 0,
        minRandomBranchChance: 0.1,
        maxRandomBranchChance: 0.8,
      }),
    );
    expect(context.elements.thresholdInput.value).toBe("45");
  });

  it("updates visualization data when tuning changes apply", () => {
    const context = createContext({
      engine: {
        getConfig: vi.fn(() => ({
          currentThreshold: 0,
          minRandomBranchChance: 0.18,
          maxRandomBranchChance: 0.5,
          randomBranchChanceDelta: 0.1,
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
    context.elements.thresholdInput.value = "40";
    context.elements.computedThresholdEl.textContent = "45";
    applyTuningChanges(context);
    expect(context.state.vizData).toEqual({ beats: [1], edges: [1] });
    expect(context.jukebox.setData).toHaveBeenCalledWith({ beats: [1], edges: [1] });
  });

  it("persists forced-branch highlight preference in localStorage", () => {
    const context = createContext();
    context.elements.highlightAnchorBranchInput.checked = true;

    applyTuningChanges(context);

    expect(context.state.highlightAnchorBranch).toBe(true);
    expect(localStorage.getItem("fj-highlight-anchor-branch")).toBe("1");
    expect(context.jukebox.setAnchorHighlightEnabled).toHaveBeenCalledWith(true);
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
          randomBranchChanceDelta: 0.1,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig: vi.fn(),
        loadAnalysis: vi.fn(),
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
    expect(context.state.deletedEdgeIds).toEqual([1, 3]);
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
          randomBranchChanceDelta: 0.1,
          justBackwards: false,
          justLongBranches: false,
          removeSequentialBranches: false,
        })),
        updateConfig,
        loadAnalysis: vi.fn(),
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
    expect(context.state.deletedEdgeIds).toEqual([2]);
  });
});

describe("playback timers", () => {
  it("updates listen time display", () => {
    const context = createContext();
    context.state.playTimerMs = 1000;
    context.state.lastPlayStamp = 0;
    vi.spyOn(performance, "now").mockReturnValue(1000);
    updateListenTimeDisplay(context);
    expect(context.elements.listenTimeEl.textContent).toBe("00:00:02");
  });
});
