import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { AnalysisComplete } from "./api";
import {
  applyExtrasChanges,
  applyAnalysisResult,
  getActiveTuningTab,
  resetExtrasDefaults,
  applyTuningChanges,
  loadAudioFromJob,
  openExtras,
  resetForNewTrack,
  setActiveTuningTab,
  startJukeboxFromBeat,
  stopPlayback,
  syncTuningTabsUI,
  syncTuningUI,
  togglePlayback,
  updateVizVisibility,
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

function createMutableClassList(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: vi.fn((token: string) => {
      classes.add(token);
    }),
    remove: vi.fn((token: string) => {
      classes.delete(token);
    }),
    toggle: vi.fn((token: string, force?: boolean) => {
      if (force === true) {
        classes.add(token);
        return true;
      }
      if (force === false) {
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    }),
    contains: vi.fn((token: string) => classes.has(token)),
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

function createPlayButton() {
  const icon = createSpan();
  const text = createSpan();
  return {
    classList: createClassList(),
    disabled: false,
    title: "",
    querySelector: vi.fn((selector: string) => {
      if (selector === ".play-icon") {
        return icon;
      }
      if (selector === ".play-text") {
        return text;
      }
      return null;
    }),
    setAttribute: vi.fn(),
  };
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
    jukeboxAudioModeGroup: { classList: createClassList() },
    audioModeOffInput: createInput(),
    audioModeNightcoreInput: createInput(),
    audioModeDaycoreInput: createInput(),
    audioModeVaporwaveInput: createInput(),
    audioModeEightDInput: createInput(),
    audioModeLofiInput: createInput(),
    audioModeSwingInput: createInput(),
    extrasEnabledInput: createInput(),
    bringHomeEnabledInput: createInput(),
    extrasJukeboxOnlyHint: { classList: createClassList() },
    tuningTitle: createSpan(),
    tuningTitleText: createSpan(),
    tuningBetaTag: { classList: createMutableClassList(["hidden"]) },
    tuningTabToggle: {
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
    tuningTabToggleIcon: createSpan(),
    tuningTabToggleLabel: createSpan(),
    tuningPanelTuning: { classList: createMutableClassList() },
    tuningPanelExtras: { classList: createMutableClassList(["hidden"]) },
    tuningModal: { classList: createClassList() },
    infoModal: { classList: createClassList() },
    extrasModal: { classList: createClassList() },
    listenTimeEl: createSpan(),
    playStatusPanel: { classList: createClassList() },
    playMenu: { classList: createClassList() },
    vizPanel: { classList: createClassList() },
    analysisStatus: createSpan(),
    analysisSpinner: { classList: createClassList() },
    analysisProgress: createSpan(),
    toast: {
      classList: createClassList(),
      innerHTML: "",
      textContent: "",
    },
    beatsPlayedEl: createSpan(),
    playButton: createPlayButton(),
    bringHomeLabel: { classList: createClassList() },
    bringHomeFullscreenLabel: { classList: createClassList() },
    playTabButton: { classList: createClassList(), disabled: false },
    vizPlayButton: createPlayButton(),
    vizSelect: { disabled: false, value: "0" },
    canonizerFinish: { checked: false, addEventListener: vi.fn() },
    playTitle: createSpan(),
    vizNowPlayingEl: createSpan(),
    infoDurationEl: createSpan(),
    infoBeatsEl: createSpan(),
    infoBranchesEl: createSpan(),
    infoDeletedBranchesEl: createSpan(),
    branchStatsPopup: { classList: createClassList() },
    branchStatsTitleEl: createSpan(),
    branchStatsStartEl: createSpan(),
    branchStatsEndEl: createSpan(),
    branchStatsDeltaEl: createSpan(),
    branchStatsDirectionEl: createSpan(),
    branchStatsSimilarityEl: createSpan(),
    deleteButton: { classList: createClassList() },
    vizStats: {
      classList: createClassList(),
      offsetWidth: 0,
    },
  };
}

function createContext(overrides?: Partial<AppContext>): AppContext {
  const elements = createElements();
  const engineConfig = {
    currentThreshold: 0,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.02,
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
    pauseJukebox: vi.fn(),
    syncToPlaybackPosition: vi.fn(),
    startJukebox: vi.fn(),
    play: vi.fn(),
    stopJukebox: vi.fn(),
    resetStats: vi.fn(),
    clearDeletedEdges: vi.fn(),
    seekToBeat: vi.fn(),
    setForceBranch: vi.fn(),
    setBringItHomeMode: vi.fn(),
  };
  const player = {
    getVolume: vi.fn(() => 0.5),
    getDuration: vi.fn(() => null),
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
      isPaused: false,
      trackDurationSec: null,
      trackTitle: null,
      trackArtist: null,
      selectedEdge: null,
      deleteEligible: false,
      deleteEligibilityJobId: null,
      shiftBranching: false,
      bringItHomeMode: false,
      lastBeatIndex: null,
      branchStatsEnabled: false,
      jukeboxAudioMode: "off",
      swingPreparing: false,
      swingRenderToken: 0,
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

  it("applies branch stats toggle and audio mode from extras controls", () => {
    const context = createContext();
    context.state.isRunning = true;
    context.state.playMode = "jukebox";
    context.elements.extrasEnabledInput.checked = true;
    context.elements.audioModeDaycoreInput.checked = true;

    const result = applyExtrasChanges(context);

    expect(result).toEqual({ branchStatsChanged: true, audioModeChanged: true });
    expect(context.state.branchStatsEnabled).toBe(true);
    expect(context.state.jukeboxAudioMode).toBe("daycore");
    expect(localStorage.getItem("fj-branch-stats-enabled")).toBe("1");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("daycore");
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
  });

  it("applies bring it home mode from extras controls", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    context.state.shiftBranching = true;
    context.elements.bringHomeEnabledInput.checked = true;

    applyExtrasChanges(context);

    expect(context.state.bringItHomeMode).toBe(true);
    expect(context.state.shiftBranching).toBe(false);
    expect(context.engine.setForceBranch).toHaveBeenCalledWith(false);
    expect(context.engine.setBringItHomeMode).toHaveBeenCalledWith(true);
    expect(context.elements.bringHomeLabel.classList.toggle).toHaveBeenCalledWith(
      "is-hidden",
      false,
    );
    expect(
      context.elements.bringHomeFullscreenLabel.classList.toggle,
    ).toHaveBeenCalledWith("is-hidden", false);
  });

  it("hides branch stats popup when extras branch stats is disabled", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    context.state.branchStatsEnabled = true;
    context.elements.extrasEnabledInput.checked = false;

    applyExtrasChanges(context);

    expect(context.elements.branchStatsPopup.classList.add).toHaveBeenCalledWith("hidden");
  });

  it("resets extras options to defaults", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    context.state.branchStatsEnabled = true;
    context.state.bringItHomeMode = true;
    context.state.jukeboxAudioMode = "nightcore";

    const result = resetExtrasDefaults(context);

    expect(result).toEqual({ branchStatsChanged: true, audioModeChanged: true });
    expect(context.state.branchStatsEnabled).toBe(false);
    expect(localStorage.getItem("fj-branch-stats-enabled")).toBe("0");
    expect(context.state.bringItHomeMode).toBe(false);
    expect(context.engine.setBringItHomeMode).toHaveBeenCalledWith(false);
    expect(context.state.jukeboxAudioMode).toBe("off");
    expect(context.elements.branchStatsPopup.classList.add).toHaveBeenCalledWith("hidden");
  });

  it("resets audio mode on track change", () => {
    setWindowUrl("http://localhost/listen/abc?am=daycore");
    const context = createContext();
    context.state.analysisLoaded = true;
    context.state.jukeboxAudioMode = "daycore";

    resetForNewTrack(context);

    expect(context.state.jukeboxAudioMode).toBe("off");
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
        getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn(),
        rebuildGraph: vi.fn(),
      } as unknown as AppContext["engine"],
    });
    context.state.playMode = "jukebox";
    context.state.jukeboxAudioMode = "nightcore";

    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: { title: "Song", artist: "Artist" } },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(context.elements.playTitle.textContent).toBe("Song (nightcore) — Artist");
    expect(context.elements.vizNowPlayingEl.textContent).toBe("Song (nightcore) — Artist");
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
        getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
        getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
        deleteEdge: vi.fn(),
        rebuildGraph: vi.fn(),
      } as unknown as AppContext["engine"],
    });
    context.state.playMode = "jukebox";
    const response: AnalysisComplete = {
      status: "complete",
      id: "job123",
      result: { beats: [], track: { title: "Song", artist: "Artist" } },
    };

    const applied = applyAnalysisResult(context, response);

    expect(applied).toBe(true);
    expect(context.state.jukeboxAudioMode).toBe("daycore");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("daycore");
    expect(context.elements.playTitle.textContent).toBe("Song (daycore) — Artist");
    expect(context.state.tuningParams).toContain("am=daycore");
  });

  it("switches modal header title/toggle visibility by active tuning tab", () => {
    const context = createContext();
    context.state.playMode = "jukebox";

    setActiveTuningTab(context, "tuning");
    expect(context.elements.tuningTitleText.textContent).toBe("Tuning");
    expect(context.elements.tuningBetaTag.classList.contains("hidden")).toBe(true);
    expect(context.elements.tuningTabToggleLabel.textContent).toBe("Extras");
    expect(context.elements.tuningTabToggle.classList.contains("hidden")).toBe(false);
    expect(getActiveTuningTab(context)).toBe("tuning");

    setActiveTuningTab(context, "extras");
    expect(context.elements.tuningTitleText.textContent).toBe("Extras");
    expect(context.elements.tuningBetaTag.classList.contains("hidden")).toBe(false);
    expect(context.elements.tuningTabToggleLabel.textContent).toBe("Tuning");
    expect(context.elements.tuningTabToggle.classList.contains("hidden")).toBe(true);
    expect(getActiveTuningTab(context)).toBe("extras");
  });

  it("opens tuning modal on extras tab", () => {
    const context = createContext();
    context.state.playMode = "jukebox";

    openExtras(context);

    expect(getActiveTuningTab(context)).toBe("extras");
    expect(context.elements.tuningModal.classList.add).toHaveBeenCalledWith("open");
  });

  it("forces tuning tab state when mode does not support extras", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    setActiveTuningTab(context, "extras");
    context.state.playMode = "autocanonizer";

    syncTuningTabsUI(context);

    expect(context.elements.tuningTitleText.textContent).toBe("Tuning");
    expect(context.elements.tuningBetaTag.classList.contains("hidden")).toBe(true);
    expect(context.elements.tuningPanelTuning.classList.contains("hidden")).toBe(false);
    expect(context.elements.tuningPanelExtras.classList.contains("hidden")).toBe(true);
    expect(context.elements.tuningTabToggle.classList.contains("hidden")).toBe(true);
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
    context.state.audioLoaded = true;
    context.state.analysisLoaded = true;
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    togglePlayback(context);

    expect(context.engine.resetStats).toHaveBeenCalledTimes(1);
    expect(context.engine.startJukebox).toHaveBeenCalledWith(true);
    expect(context.state.isRunning).toBe(true);
    expect(context.state.isPaused).toBe(false);

    togglePlayback(context);

    expect(context.engine.pauseJukebox).toHaveBeenCalledTimes(1);
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(context.state.isRunning).toBe(false);
    expect(context.state.isPaused).toBe(true);
    expect(context.elements.playButton.setAttribute).toHaveBeenLastCalledWith(
      "aria-label",
      "Resume",
    );

    togglePlayback(context);

    expect(context.engine.resetStats).toHaveBeenCalledTimes(1);
    expect(context.engine.startJukebox).toHaveBeenLastCalledWith(false);
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(2);
    expect(context.state.isRunning).toBe(true);
    expect(context.state.isPaused).toBe(false);
  });

  it("blocks jukebox playback while swing mode is preparing", () => {
    const context = createContext();
    context.state.audioLoaded = true;
    context.state.analysisLoaded = true;
    context.state.jukeboxAudioMode = "swing";
    context.state.swingPreparing = true;
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    togglePlayback(context);

    expect(context.engine.play).not.toHaveBeenCalled();
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
    expect(context.state.isRunning).toBe(false);
    expect(context.elements.playButton.disabled).toBe(true);
    expect(context.elements.playButton.setAttribute).toHaveBeenLastCalledWith(
      "aria-label",
      "Preparing Swing mode",
    );
    expect(context.elements.vizPlayButton.disabled).toBe(true);
  });

  it("shows only loading status panel while swing mode is preparing", () => {
    const context = createContext();
    context.state.audioLoaded = true;
    context.state.analysisLoaded = true;
    context.state.jukeboxAudioMode = "swing";
    context.state.swingPreparing = true;

    updateVizVisibility(context);

    expect(context.elements.playStatusPanel.classList.remove).toHaveBeenCalledWith(
      "hidden",
    );
    expect(context.elements.playMenu.classList.add).toHaveBeenCalledWith("hidden");
    expect(context.elements.vizPanel.classList.add).toHaveBeenCalledWith("hidden");
    expect(context.elements.playButton.classList.add).toHaveBeenCalledWith("hidden");
    expect(context.elements.vizSelect.disabled).toBe(true);
  });

  it("blocks beat-start playback while swing mode is preparing", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    context.state.jukeboxAudioMode = "swing";
    context.state.swingPreparing = true;
    context.state.vizData = {
      beats: [{ start: 2, duration: 1 }],
      edges: [],
    } as unknown as AppContext["state"]["vizData"];
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    startJukeboxFromBeat(context, 0);

    expect(context.player.seek).not.toHaveBeenCalled();
    expect(context.engine.seekToBeat).not.toHaveBeenCalled();
    expect(context.engine.play).not.toHaveBeenCalled();
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
    expect(context.elements.playButton.disabled).toBe(true);
  });

  it("stop clears paused state and forces next play to restart", () => {
    const context = createContext();
    context.state.audioLoaded = true;
    context.state.analysisLoaded = true;
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);

    togglePlayback(context);
    togglePlayback(context);
    context.state.playTimerMs = 12345;
    context.state.lastBeatIndex = 7;
    context.elements.beatsPlayedEl.textContent = "7";
    stopPlayback(context);

    expect(context.state.isPaused).toBe(false);
    expect(context.state.isRunning).toBe(false);
    expect(context.state.playTimerMs).toBe(0);
    expect(context.state.lastBeatIndex).toBe(null);
    expect(context.elements.beatsPlayedEl.textContent).toBe("0");
    expect(context.engine.stopJukebox).toHaveBeenCalled();
    expect(context.engine.resetStats).toHaveBeenCalled();
    expect(context.jukebox.reset).toHaveBeenCalled();

    togglePlayback(context);

    expect(context.engine.resetStats).toHaveBeenCalledTimes(3);
    expect(context.engine.startJukebox).toHaveBeenLastCalledWith(true);
  });

  it("resumes audio output when selecting a beat while session is running", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    context.state.isRunning = true;
    context.state.vizData = {
      beats: [{ start: 0, duration: 1 }],
      edges: [],
    } as unknown as AppContext["state"]["vizData"];
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
    context.state.playMode = "jukebox";
    context.state.isRunning = true;
    context.state.vizData = {
      beats: [{ start: 2, duration: 1 }],
      edges: [],
    } as unknown as AppContext["state"]["vizData"];
    (context.player.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(120);
    (context.player.isPlaying as ReturnType<typeof vi.fn>).mockReturnValue(true);

    startJukeboxFromBeat(context, 0);

    expect(context.player.seek).toHaveBeenCalledWith(2);
    expect(context.engine.seekToBeat).toHaveBeenCalledWith(0);
    expect(context.engine.play).not.toHaveBeenCalled();
    expect(context.engine.startJukebox).not.toHaveBeenCalled();
  });
});

describe("playback loading", () => {
  it("returns false on missing audio without calling repair endpoint", async () => {
    const context = createContext();
    context.state.audioLoadInFlight = true;
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const loaded = await loadAudioFromJob(context, "upload-job");

    expect(loaded).toBe(false);
    expect(context.state.audioLoadInFlight).toBe(false);
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe("/api/audio/upload-job");
    expect(calls.some((call) => String(call[0]).includes("/api/repair/"))).toBe(
      false,
    );
  });
});
