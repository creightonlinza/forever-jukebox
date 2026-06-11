import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { AnalysisComplete } from "./api";
import {
  applyExtrasChanges,
  applyAnalysisResult,
  getActiveTuningTab,
  resetExtrasDefaults,
  resetTuningDefaults,
  applyTuningChanges,
  loadAudioFromJob,
  loadTrackById,
  openExtras,
  pollAnalysis,
  resetForNewTrack,
  setSleepTimer,
  setActiveTuningTab,
  startJukeboxFromBeat,
  stopPlayback,
  syncTuningTabsUI,
  syncTuningUI,
  togglePlayback,
  updateVizVisibility,
  updateListenTimeDisplay,
} from "./playback";
import { createPlaybackUiHandlers } from "./wire/playback";
import { setWindowUrl } from "./__tests__/test-utils";
import { getOrCreateSwingBuffer } from "../audio/swingBufferCache";
import { renderSwingBuffer } from "../audio/swingRenderer";
import { ADMIN_KEY_STORAGE_KEY } from "./admin";

vi.mock("../audio/swingBufferCache", () => ({
  getOrCreateSwingBuffer: vi.fn(
    (
      _sourceBuffer: AudioBuffer,
      _sourceIdentity: string | null,
      render: () => Promise<AudioBuffer>,
    ) => render(),
  ),
}));

vi.mock("../audio/swingRenderer", () => ({
  renderSwingBuffer: vi.fn(async () => ({ duration: 120 }) as AudioBuffer),
}));

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

function createInput(initial = "") {
  return { value: initial, checked: false } as HTMLInputElement;
}

async function flushMicrotasks(count = 5) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
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
    audioModeEightBitInput: createInput(),
    audioModeLofiInput: createInput(),
    audioModeUnderwaterInput: createInput(),
    audioModeCathedralInput: createInput(),
    audioModeCowbellInput: createInput(),
    audioModeSwingInput: createInput(),
    extrasEnabledInput: createInput(),
    bringHomeEnabledInput: createInput(),
    extrasJukeboxOnlyHint: { classList: createClassList() },
    tuningTitle: {
      textContent: "",
      classList: createMutableClassList(),
    },
    tuningTitleText: createSpan(),
    tuningTabToggle: {
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
    tuningTabToggleIcon: createSpan(),
    tuningTabToggleLabel: createSpan(),
    sleepTimerOpen: {
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
    sleepTimerModal: { classList: createMutableClassList() },
    sleepTimerClose: {
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
    sleepTimerCancel: {
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
    sleepTimerSet: {
      classList: createMutableClassList(),
      setAttribute: vi.fn(),
    },
    sleepTimerSelect: { value: "off" },
    sleepTimerCurrent: createSpan(),
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
    branchStatsDeleteButton: { disabled: false },
    deleteButton: {
      classList: createClassList(),
      title: "",
      setAttribute: vi.fn(),
    },
    deleteConfirmModal: { classList: createMutableClassList() },
    vizStats: {
      classList: createClassList(),
      offsetWidth: 0,
    },
  };
}

function createContext(overrides?: Partial<AppContext>): AppContext {
  const elements = createElements();
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
  };
  const player = {
    getVolume: vi.fn(() => 0.5),
    getDuration: vi.fn(() => null),
    setVolume: vi.fn(),
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
    setSelectedEdgeActive: vi.fn(),
    resizeActive: vi.fn(),
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
  return {
    elements: elements as unknown as AppContext["elements"],
    engine: engine as unknown as AppContext["engine"],
    player: player as unknown as AppContext["player"],
    autocanonizer: autocanonizer as unknown as AppContext["autocanonizer"],
    jukebox: jukebox as unknown as AppContext["jukebox"],
    cowbellOverlay: cowbellOverlay as unknown as AppContext["cowbellOverlay"],
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
      lastTrackId: null,
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
      sleepTimer: {
        configuredDurationMs: null,
        endTimeMs: null,
        remainingMs: 0,
      },
      sleepTimerTimeoutId: null,
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

  it("preserves selected tuning while resetting for a new track", () => {
    setWindowUrl("http://localhost/listen/favorite?jb=1&d=2,8");
    const context = createContext();
    context.state.lastTrackId = "old-track";
    context.state.tuningParams = "jb=1&d=2,8";

    resetForNewTrack(context, { clearTuning: false });

    expect(context.state.tuningParams).toBe("jb=1&d=2,8");
    expect(window.location.search).toBe("?jb=1&d=2,8");
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

  it("applies cowbell as an audio mode from extras controls", () => {
    const context = createContext();
    context.state.playMode = "jukebox";
    context.elements.audioModeCowbellInput.checked = true;

    const result = applyExtrasChanges(context);

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(context.state.jukeboxAudioMode).toBe("cowbell");
    expect(context.cowbellOverlay.enable).toHaveBeenCalledTimes(1);
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("cowbell");
    expect(window.location.search).toContain("am=cowbell");
  });

  it("applies eight-bit as an audio mode from extras controls", () => {
    const context = createContext();
    context.state.analysisLoaded = true;
    context.state.audioLoaded = true;
    context.elements.audioModeEightBitInput.checked = true;

    const result = applyExtrasChanges(context);

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(context.state.jukeboxAudioMode).toBe("eight_bit");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("eight_bit");
    expect(window.location.search).toContain("am=eight_bit");
  });

  it("applies underwater as an audio mode from extras controls", () => {
    const context = createContext();
    context.elements.audioModeUnderwaterInput.checked = true;

    const result = applyExtrasChanges(context);

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(context.state.jukeboxAudioMode).toBe("underwater");
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith("underwater");
    expect(window.location.search).toContain("am=underwater");
  });

  it("applies cathedral as an audio mode from extras controls", () => {
    const context = createContext();
    context.elements.audioModeCathedralInput.checked = true;

    const result = applyExtrasChanges(context);

    expect(result).toEqual({ branchStatsChanged: false, audioModeChanged: true });
    expect(context.state.jukeboxAudioMode).toBe("cathedral");
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
    context.state.playMode = "jukebox";
    context.state.isRunning = true;
    context.state.audioLoaded = true;
    context.state.analysisLoaded = true;
    context.state.vizData = {
      beats: [{ start: 0, duration: 1 }],
      edges: [],
    } as unknown as AppContext["state"]["vizData"];
    context.elements.audioModeSwingInput.checked = true;
    vi.mocked(context.player.getDuration).mockReturnValue(120);
    vi.mocked(context.player.getSourceBuffer).mockReturnValue(sourceBuffer);
    vi.mocked(renderSwingBuffer).mockResolvedValue(swingBuffer);

    applyExtrasChanges(context);
    await flushMicrotasks();

    expect(context.engine.pauseJukebox).toHaveBeenCalledTimes(1);
    expect(context.player.setRenderedJukeboxAudioBuffer).toHaveBeenCalledWith(
      "swing",
      swingBuffer,
    );
    expect(context.engine.startJukebox).toHaveBeenLastCalledWith(false);
    expect(context.engine.play).toHaveBeenCalledTimes(1);
    expect(context.state.isRunning).toBe(true);
    expect(context.state.isPaused).toBe(false);
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
    expect(context.cowbellOverlay.disable).toHaveBeenCalledTimes(1);
    expect(context.elements.branchStatsPopup.classList.add).toHaveBeenCalledWith("hidden");
  });

  it("preserves audio mode URL param when tuning reset clears other tuning params", () => {
    setWindowUrl("http://localhost/listen/abc?jb=1&thresh=30&ab=7&am=daycore");
    const context = createContext();
    context.state.tuningParams = "jb=1&thresh=30&ab=7&am=daycore";
    context.state.jukeboxAudioMode = "daycore";
    context.engine.setUserAnchorEdge(
      { id: 7 } as Parameters<AppContext["engine"]["setUserAnchorEdge"]>[0],
    );

    resetTuningDefaults(context);

    expect(context.state.tuningParams).toBe("am=daycore");
    expect(window.location.search).toBe("?am=daycore");
    expect(context.state.jukeboxAudioMode).toBe("daycore");
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
    expect(context.state.deletedEdgeIds).toEqual([1, 3]);
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
    expect(context.state.deleteEligible).toBe(false);
    expect(context.state.deleteEligibilityJobId).toBe("job123");
    expect(context.elements.deleteButton.classList.toggle).toHaveBeenCalledWith(
      "hidden",
      false,
    );
    expect(context.elements.deleteButton.title).toBe("Delete track");
    expect(context.elements.deleteButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Delete track",
    );
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
    expect(context.state.deleteEligible).toBe(true);
    expect(context.elements.deleteButton.classList.toggle).toHaveBeenCalledWith(
      "hidden",
      false,
    );
    expect(context.elements.deleteButton.title).toBe(
      "Delete within 30 minutes of creation",
    );
    expect(context.elements.deleteButton.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Delete within 30 minutes of creation",
    );
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
    expect(context.state.tuningParams).toContain("ab=3");
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
        getSectionStartBeatIndices: vi.fn(() => [4, 12]),
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
    expect(context.cowbellOverlay.setSectionStartBeatIndices).toHaveBeenCalledWith([
      4,
      12,
    ]);
    expect(context.elements.playTitle.textContent).toBe("Song (daycore) — Artist");
    expect(context.state.tuningParams).toContain("am=daycore");
  });

  it("switches modal header title/toggle visibility by active tuning tab", () => {
    const context = createContext();
    context.state.playMode = "jukebox";

    setActiveTuningTab(context, "tuning");
    expect(context.elements.tuningTitleText.textContent).toBe("Tuning");
    expect(context.elements.tuningTitle.classList.contains("is-extras-active")).toBe(
      false,
    );
    expect(context.elements.tuningTabToggleLabel.textContent).toBe("Extras");
    expect(context.elements.tuningTabToggle.classList.contains("hidden")).toBe(false);
    expect(getActiveTuningTab(context)).toBe("tuning");

    setActiveTuningTab(context, "extras");
    expect(context.elements.tuningTitleText.textContent).toBe("Extras");
    expect(context.elements.tuningTitle.classList.contains("is-extras-active")).toBe(
      true,
    );
    expect(context.elements.tuningTabToggleLabel.textContent).toBe("Tuning");
    expect(context.elements.tuningTabToggle.classList.contains("hidden")).toBe(false);
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
    expect(context.elements.tuningTitle.classList.contains("is-extras-active")).toBe(
      false,
    );
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
    expect(context.state.deletedEdgeIds).toEqual([2]);
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
    const context = createContext();
    context.state.playTimerMs = 1000;
    context.state.lastPlayStamp = 0;
    vi.spyOn(performance, "now").mockReturnValue(1000);
    updateListenTimeDisplay(context);
    expect(context.elements.listenTimeEl.textContent).toBe("00:00:02");
  });

  it("maps null, zero, negative, and unknown sleep timer durations to off", () => {
    setupSleepTimerClock();
    const context = createContext();

    for (const durationMs of [null, 0, -1, Number.NaN]) {
      setSleepTimer(context, 30 * 60 * 1000);
      setSleepTimer(context, durationMs);

      expect(context.state.sleepTimer).toEqual({
        configuredDurationMs: null,
        endTimeMs: null,
        remainingMs: 0,
      });
      expect(context.state.sleepTimerTimeoutId).toBe(null);
    }
  });

  it("sets sleep timer state from monotonic time", () => {
    setupSleepTimerClock(5000);
    const context = createContext();

    setSleepTimer(context, 15 * 60 * 1000);

    expect(context.state.sleepTimer).toEqual({
      configuredDurationMs: 15 * 60 * 1000,
      endTimeMs: 905000,
      remainingMs: 15 * 60 * 1000,
    });
    expect(context.state.sleepTimerTimeoutId).not.toBe(null);
  });

  it("replacing a sleep timer cancels the old expiry", () => {
    const clock = setupSleepTimerClock(1000);
    const context = createContext();
    context.state.isRunning = true;

    setSleepTimer(context, 1000);
    setSleepTimer(context, 5000);
    clock.setNow(2000);
    vi.advanceTimersByTime(1000);

    expect(context.engine.stopJukebox).not.toHaveBeenCalled();
    expect(context.state.sleepTimer.configuredDurationMs).toBe(5000);
    expect(context.state.sleepTimer.remainingMs).toBe(4000);
  });

  it("expires by clearing timer state, stopping playback, and exiting fullscreen", () => {
    const clock = setupSleepTimerClock(1000);
    const exitFullscreen = vi.fn(async () => undefined);
    vi.stubGlobal("document", {
      fullscreenElement: {},
      exitFullscreen,
    });
    const context = createContext();
    context.state.isRunning = true;
    context.state.isPaused = false;
    context.state.playTimerMs = 1234;
    context.elements.beatsPlayedEl.textContent = "8";

    setSleepTimer(context, 1000);
    clock.setNow(2000);
    vi.advanceTimersByTime(1000);

    expect(context.state.sleepTimer).toEqual({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
    expect(context.state.isRunning).toBe(false);
    expect(context.state.isPaused).toBe(false);
    expect(context.engine.stopJukebox).toHaveBeenCalled();
    expect(context.elements.beatsPlayedEl.textContent).toBe("0");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("schedules the final partial second without waiting a full extra tick", () => {
    const clock = setupSleepTimerClock(1000);
    const context = createContext();
    context.state.isRunning = true;

    setSleepTimer(context, 1500);
    clock.setNow(2000);
    vi.advanceTimersByTime(1000);

    expect(context.state.sleepTimer.remainingMs).toBe(500);
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

describe("playback branch shortcuts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setWindowUrl("http://localhost/listen/abc");
  });

  function makeHandlers(context: AppContext, showToast = vi.fn()) {
    const writeTuningParamsToUrl = vi.fn();
    return {
      handlers: createPlaybackUiHandlers({
        context,
        elements: context.elements,
        state: context.state,
        player: context.player,
        engine: context.engine,
        jukebox: context.jukebox,
        autocanonizer: context.autocanonizer,
        vizStorageKey: "viz",
        canonizerFinishKey: "finish",
        setAnalysisStatus: vi.fn(),
        showToast,
        stopPlayback: vi.fn(),
        togglePlayback: vi.fn(),
        startJukeboxFromBeat: vi.fn(),
        startAutocanonizerPlayback: vi.fn(),
        updateTrackUrl: vi.fn(),
        navigateToTab: vi.fn(),
        updateVizVisibility: vi.fn(),
        openExtras: vi.fn(),
        syncTuningTabsUI: vi.fn(),
        getTuningParamsFromEngine: vi.fn(() => {
          const params = new URLSearchParams();
          const anchorId = context.engine.getUserAnchorEdgeId();
          if (anchorId !== null) {
            params.set("ab", `${anchorId}`);
          }
          return params;
        }),
        writeTuningParamsToUrl,
        syncDeletedEdgeState: vi.fn(),
        updateTrackInfo: vi.fn(),
        isEditableTarget: vi.fn(() => false),
        getCurrentTrackId: vi.fn(() => null),
      }),
      showToast,
      writeTuningParamsToUrl,
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
    context.state.selectedEdge = edge as AppContext["state"]["selectedEdge"];
    context.state.vizData = {
      beats: [],
      edges: [edge],
      lastBranchPoint: 1,
      anchorEdgeId: null,
    } as unknown as AppContext["state"]["vizData"];
    const nextVizData = {
      beats: [],
      edges: [edge],
      lastBranchPoint: 1,
      anchorEdgeId: 7,
    };
    (
      context.engine.getVisualizationData as ReturnType<typeof vi.fn>
    ).mockReturnValue(nextVizData);
    const { handlers, showToast, writeTuningParamsToUrl } = makeHandlers(context);
    const setEvent = keyEvent("A");

    handlers.handleKeydown(setEvent);

    expect(setEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.engine.setUserAnchorEdge).toHaveBeenCalledWith(edge);
    expect(context.jukebox.setData).toHaveBeenCalledWith(nextVizData);
    expect(context.jukebox.setSelectedEdgeActive).toHaveBeenCalledWith(edge);
    expect(showToast).toHaveBeenCalledWith(context, "Anchor branch set");
    expect(writeTuningParamsToUrl).toHaveBeenCalledWith("ab=7", true);

    const resetEvent = keyEvent("a");
    handlers.handleKeydown(resetEvent);

    expect(resetEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.engine.setUserAnchorEdge).toHaveBeenLastCalledWith(null);
    expect(showToast).toHaveBeenLastCalledWith(context, "Anchor branch reset");
    expect(writeTuningParamsToUrl).toHaveBeenLastCalledWith(null, true);
  });

  it("ignores A for a selected forward branch", () => {
    const context = createContext();
    const edge = {
      id: 8,
      src: { which: 2 },
      dest: { which: 5 },
      deleted: false,
    };
    context.state.selectedEdge = edge as AppContext["state"]["selectedEdge"];
    const { handlers } = makeHandlers(context);
    const event = keyEvent("A");

    handlers.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.engine.setUserAnchorEdge).not.toHaveBeenCalled();
  });

  it("ignores playback shortcuts while track delete confirmation is open", () => {
    const context = createContext();
    context.elements.deleteConfirmModal.classList.add("open");
    context.state.selectedEdge = {
      id: 9,
      src: { which: 8 },
      dest: { which: 2 },
      deleted: false,
    } as AppContext["state"]["selectedEdge"];
    const { handlers } = makeHandlers(context);
    const event = keyEvent("Delete");

    handlers.handleKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.engine.deleteEdge).not.toHaveBeenCalled();
  });

  it("shows branch stats and enables delete for a selected active branch", () => {
    const context = createContext();
    context.state.branchStatsEnabled = true;
    const edge = {
      id: 12,
      src: { which: 8, start: 32 },
      dest: { which: 2, start: 8 },
      distance: 20,
      deleted: false,
    };
    const { handlers } = makeHandlers(context);

    handlers.handleEdgeSelect(edge as AppContext["state"]["selectedEdge"]);

    expect(context.state.selectedEdge).toBe(edge);
    expect(context.jukebox.setSelectedEdgeActive).toHaveBeenCalledWith(edge);
    expect(context.elements.branchStatsTitleEl.textContent).toBe("Branch #12 stats");
    expect(context.elements.branchStatsStartEl.textContent).toBe("00:00:32");
    expect(context.elements.branchStatsEndEl.textContent).toBe("00:00:08");
    expect(context.elements.branchStatsDeltaEl.textContent).toBe("-00:00:24");
    expect(context.elements.branchStatsDirectionEl.textContent).toBe("Backward");
    expect(context.elements.branchStatsSimilarityEl.textContent).toBe("75%");
    expect(context.elements.branchStatsDeleteButton.disabled).toBe(false);
    expect(context.elements.branchStatsPopup.classList.remove).toHaveBeenCalledWith(
      "hidden",
    );
  });

  it("hides branch stats and disables delete for a deleted selected branch", () => {
    const context = createContext();
    context.state.branchStatsEnabled = true;
    const edge = {
      id: 13,
      src: { which: 8, start: 32 },
      dest: { which: 2, start: 8 },
      distance: 20,
      deleted: true,
    };
    const { handlers } = makeHandlers(context);

    handlers.handleEdgeSelect(edge as AppContext["state"]["selectedEdge"]);

    expect(context.elements.branchStatsDeleteButton.disabled).toBe(true);
    expect(context.elements.branchStatsPopup.classList.remove).toHaveBeenCalledWith(
      "hidden",
    );
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

    expect(context.state.lastTrackId).toBe(jobId);
    expect(context.state.lastJobId).toBe(jobId);
    expect(context.state.lastSourceProvider).toBe("youtube");
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

    expect(context.state.lastTrackId).toBe(jobId);
    expect(context.state.lastJobId).toBe(jobId);
    expect(context.state.lastSourceProvider).toBe("upload");
    expect(deps.onTrackChange).toHaveBeenCalledWith(jobId);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      `/api/analysis/${jobId}`,
    );
  });

  it("marks the matching saved playlist item current on preserved route loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    context.state.playlist = {
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
    };
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "soundcloud:sc-123", {
      preservePlaylist: true,
    });

    expect(context.state.playlist.currentIndex).toBe(1);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("appends missing route-loaded tracks to saved playlists", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    context.state.playlist = {
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
    };
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside", {
      preservePlaylist: true,
    });

    expect(context.state.playlist.currentIndex).toBe(2);
    expect(context.state.playlist.tracks.map((track) => track.id)).toEqual([
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
    context.state.playlist = {
      tracks: Array.from({ length: 10 }, (_, index) => ({
        id: `saved-${index}`,
        sourceType: "youtube" as const,
        title: `Saved ${index}`,
        artist: "",
        duration: null,
      })),
      currentIndex: -1,
    };
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside", {
      preservePlaylist: true,
    });

    expect(context.state.playlist.currentIndex).toBe(9);
    expect(context.state.playlist.tracks).toHaveLength(10);
    expect(context.state.playlist.tracks[9]?.id).toBe("outside");
    expect(context.state.playlist.tracks[8]?.id).toBe("saved-8");
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("replaces only the current active playlist item on normal track loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    context.state.playlist = {
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
    };
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

    expect(context.state.playlist.currentIndex).toBe(0);
    expect(context.state.playlist.tracks.map((track) => track.id)).toEqual([
      "outside",
      "next",
    ]);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

  it("clears inactive saved playlists on normal track loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = createContext();
    context.state.playlist = {
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
    };
    const deps = createLoadDeps();

    await loadTrackById(context, deps, "outside");

    expect(context.state.playlist.tracks).toEqual([]);
    expect(context.state.playlist.currentIndex).toBe(-1);
    expect(deps.onPlaylistChange).toHaveBeenCalledOnce();
  });

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
    expect(context.state.audioLoaded).toBe(true);
    expect(context.state.analysisLoaded).toBe(true);
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
    expect(context.state.analysisLoaded).toBe(false);
  });
});
