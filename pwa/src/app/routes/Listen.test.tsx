import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Listen } from "./Listen";
import { getOrCreateSwingBuffer } from "@/shared/jukebox/audio/swingBufferCache";
import { renderSwingBuffer } from "@/shared/jukebox/audio/swingRenderer";

const exportMocks = vi.hoisted(() => ({
  exportJukeboxAudio: vi.fn(),
  pickBinaryExportFile: vi.fn(),
  saveExportBinary: vi.fn(),
}));

const mockAppState = {
  file: null as File | null,
  setIsListenLoading: vi.fn<(loading: boolean) => void>(),
};

type MockAutocanonizerInstance = {
  setFinishOutSong: ReturnType<typeof vi.fn>;
};

const autocanonizerInstances: MockAutocanonizerInstance[] = [];
type MockPlayerInstance = {
  emitEnded: () => void;
  getAudioMode: () => string;
};
const playerInstances: MockPlayerInstance[] = [];
type MockJukeboxControllerInstance = {
  emitEdgeSelect: (edge: unknown) => void;
  setData: ReturnType<typeof vi.fn>;
  setSelectedEdgeActive: ReturnType<typeof vi.fn>;
};
const jukeboxControllerInstances: MockJukeboxControllerInstance[] = [];
type MockEngineInstance = {
  pauseJukebox: ReturnType<typeof vi.fn>;
  syncToPlaybackPosition: ReturnType<typeof vi.fn>;
  stopJukebox: ReturnType<typeof vi.fn>;
  startJukebox: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  setUserAnchorEdge: ReturnType<typeof vi.fn>;
  getUserAnchorEdgeId: ReturnType<typeof vi.fn>;
};
const engineInstances: MockEngineInstance[] = [];

const mockAnalysis = {
  sections: [{ start: 0, duration: 4, confidence: 1 }],
  bars: [{ start: 0, duration: 1, confidence: 1 }],
  beats: [
    { start: 0, duration: 1, confidence: 1 },
    { start: 1, duration: 1, confidence: 1 },
  ],
  tatums: [{ start: 0, duration: 0.5, confidence: 1 }],
  segments: [
    {
      start: 0,
      duration: 1,
      confidence: 1,
      loudness_start: 0,
      loudness_max: 0,
      loudness_max_time: 0,
      pitches: new Array(12).fill(0),
      timbre: new Array(12).fill(0),
    },
  ],
  track: { duration: 4, tempo: 120, time_signature: 4 },
};

vi.mock("../state/AppState", () => ({
  useAppState: () => mockAppState,
}));

vi.mock("@/core/infrastructure/analysis/AnalysisWorkerClient", () => ({
  AnalysisWorkerClient: class AnalysisWorkerClient {},
}));

vi.mock("@/core/infrastructure/audio/AudioDecoder", () => ({
  AudioDecoder: class AudioDecoder {
    constructor(_context: unknown) {}
  },
}));

vi.mock("@/core/infrastructure/cache/analysisCache", () => ({
  createAnalysisCache: () => ({}),
}));

vi.mock("@/core/application/usecases/analyzeAudio", () => ({
  AnalyzeAudioUseCase: class AnalyzeAudioUseCase {
    constructor(_port: unknown, _cache: unknown, _decoder: unknown) {}

    async execute({ onProgress }: { onProgress?: (value: any) => void }) {
      onProgress?.({ stage: "loading", progress: 0, message: "Loading file" });
      onProgress?.({ stage: "ready", progress: 100, message: "Ready" });
      return {
        analysis: mockAnalysis,
        audioBuffer: {} as AudioBuffer,
        fromCache: false,
      };
    }
  },
}));

vi.mock("@/shared/jukebox/audio/BufferedAudioPlayer", () => ({
  BufferedAudioPlayer: class BufferedAudioPlayer {
    private volume = 0.5;
    private onEnded: (() => void) | null = null;
    private audioMode = "off";
    constructor() {
      playerInstances.push(this);
    }
    async loadBuffer(_buffer: AudioBuffer) {}
    getContext() {
      return {
        destination: {},
        createGain: () => ({
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
      } as unknown as AudioContext;
    }
    setOnEnded(handler: (() => void) | null) {
      this.onEnded = handler;
    }
    getBuffer() {
      return {} as AudioBuffer;
    }
    getSourceBuffer() {
      return {} as AudioBuffer;
    }
    stop() {}
    seek(_time: number) {}
    isPlaying() {
      return false;
    }
    setVolume(value: number) {
      this.volume = value;
    }
    getVolume() {
      return this.volume;
    }
    setJukeboxAudioMode(mode: string) {
      this.audioMode = mode;
    }
    getJukeboxAudioMode() {
      return this.audioMode;
    }
    setRenderedJukeboxAudioBuffer(_mode: string, _buffer: AudioBuffer) {}
    getRenderedJukeboxAudioBuffer(_mode: string) {
      return null;
    }
    getPlaybackRate() {
      return 1;
    }
    emitEnded() {
      this.onEnded?.();
    }
    getAudioMode() {
      return this.audioMode;
    }
    async dispose() {}
  },
}));

vi.mock("@/shared/jukebox/audio/swingBufferCache", () => ({
  getOrCreateSwingBuffer: vi.fn(
    (
      _sourceBuffer: AudioBuffer,
      _sourceIdentity: string | null,
      render: () => Promise<AudioBuffer>,
    ) => render(),
  ),
}));

vi.mock("@/shared/jukebox/audio/swingRenderer", () => ({
  renderSwingBuffer: vi.fn(async () => ({ duration: 4 }) as AudioBuffer),
}));

vi.mock("@/shared/jukebox/export", () => ({
  exportJukeboxAudio: exportMocks.exportJukeboxAudio,
}));

vi.mock("@/shared/utils/exportJson", () => ({
  pickBinaryExportFile: exportMocks.pickBinaryExportFile,
  saveExportBinary: exportMocks.saveExportBinary,
}));

vi.mock("@/shared/jukebox/engine", () => ({
  JukeboxEngine: class JukeboxEngine {
    private config = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 0,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.02,
      minLongBranch: 0,
    };
    private analysis: typeof mockAnalysis | null = null;
    pauseJukebox = vi.fn();
    syncToPlaybackPosition = vi.fn();
    stopJukebox = vi.fn();
    resetStats = vi.fn();
    startJukebox = vi.fn();
    play = vi.fn();
    seekToBeat = vi.fn();
    setForceBranch = vi.fn();
    setBringItHomeMode = vi.fn();
    setUserAnchorEdge = vi.fn();
    getUserAnchorEdgeId = vi.fn(() => null);
    deleteEdge = vi.fn();
    rebuildGraph = vi.fn();
    clearDeletedEdges = vi.fn();
    constructor(_player: unknown) {
      engineInstances.push(this);
    }
    loadAnalysis(data: typeof mockAnalysis) {
      this.analysis = data;
    }
    onUpdate(_listener: (state: any) => void) {}
    updateConfig(partial: Partial<typeof this.config>) {
      this.config = { ...this.config, ...partial };
    }
    getConfig() {
      return { ...this.config };
    }
    getGraphState() {
      return {
        computedThreshold: 20,
        currentThreshold: 20,
        totalBeats: this.analysis?.beats.length ?? 0,
        allEdges: [],
      };
    }
    getVisualizationData() {
      return {
        beats: this.analysis?.beats ?? [],
        edges: [],
      };
    }
    getSectionStartBeatIndices() {
      return [];
    }
  },
}));

vi.mock("@/shared/jukebox/viz/JukeboxController", () => ({
  JukeboxController: class JukeboxController {
    private onEdgeSelect: ((edge: unknown) => void) | null = null;
    constructor(_layer: HTMLElement) {
      jukeboxControllerInstances.push(this);
    }
    setActiveIndex(_index: number) {}
    setVisible(_visible: boolean) {}
    setAnchorHighlightEnabled(_enabled: boolean) {}
    resizeActive() {}
    reset() {}
    setData = vi.fn((_data: unknown) => {});
    setOnSelect(_handler: (index: number) => void) {}
    setOnEdgeSelect(handler: (edge: unknown) => void) {
      this.onEdgeSelect = handler;
    }
    setSelectedEdge(_edge: unknown) {}
    setSelectedEdgeActive = vi.fn((_edge: unknown) => {});
    update(_index: number, _animate: boolean, _jumpFrom: number | null) {}
    destroy() {}
    getCount() {
      return 2;
    }
    emitEdgeSelect(edge: unknown) {
      this.onEdgeSelect?.(edge);
    }
  },
}));

vi.mock("@/shared/jukebox/autocanonizer/AutocanonizerController", () => ({
  AutocanonizerController: class AutocanonizerController {
    private onBeat: ((index: number) => void) | null = null;
    private onEnded: (() => void) | null = null;
    setFinishOutSong = vi.fn((_enabled: boolean) => {});
    constructor(_layer: HTMLElement) {
      autocanonizerInstances.push(this);
    }
    setVisible(_visible: boolean) {}
    resizeNow() {}
    setOnBeat(handler: ((index: number) => void) | null) {
      this.onBeat = handler;
    }
    setOnEnded(handler: (() => void) | null) {
      this.onEnded = handler;
    }
    setOnSelect(_handler: ((index: number) => void) | null) {}
    setVolume(_volume: number) {}
    setAudio(_buffer: AudioBuffer | null, _context: AudioContext | null) {}
    setAnalysis(_analysis: unknown, _durationOverride?: number | null) {}
    resetVisualization() {}
    isReady() {
      return true;
    }
    startAtIndex(index: number) {
      this.onBeat?.(index);
      this.onEnded?.();
    }
    stop() {}
    reset() {}
    destroy() {}
  },
}));

vi.mock("@/ui/components/ProgressSteps", () => ({
  ProgressSteps: () => <div data-testid="progress-steps" />,
}));

vi.mock("@/ui/components/SymbolIcon", () => ({
  SymbolIcon: ({ name, className }: { name: string; className?: string }) => (
    <span className={className}>{name}</span>
  ),
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type RenderedListen = {
  container: HTMLDivElement;
  rerender: () => void;
  unmount: () => void;
};

function renderListen(): RenderedListen {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Listen />
      </MemoryRouter>
    );
  });
  return {
    container,
    rerender: () => {
      act(() => {
        root.render(
          <MemoryRouter
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <Listen />
          </MemoryRouter>
        );
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function changeSelect(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function keydown(key: string, code?: string) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
        bubbles: true,
      })
    );
  });
}

async function settleEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function getRequired<T extends Element>(container: ParentNode, selector: string): T {
  const node = container.querySelector(selector);
  if (!node) {
    throw new Error(`Expected element not found: ${selector}`);
  }
  return node as T;
}

async function openTuningModal(container: ParentNode) {
  const tuningButton = getRequired<HTMLButtonElement>(container, "#tuning");
  await click(tuningButton);
}

async function switchToExtrasTab(container: ParentNode) {
  const tabToggle = getRequired<HTMLButtonElement>(container, "#tuning-tab-toggle");
  await click(tabToggle);
}

describe("Listen route behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    autocanonizerInstances.length = 0;
    playerInstances.length = 0;
    jukeboxControllerInstances.length = 0;
    engineInstances.length = 0;
    mockAppState.file = new File([new Uint8Array([1, 2, 3])], "song.wav", {
      lastModified: 1234,
    });
    mockAppState.setIsListenLoading.mockReset();
    exportMocks.exportJukeboxAudio.mockReset();
    exportMocks.exportJukeboxAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      extension: "mp3",
      mimeType: "audio/mpeg",
      renderedDurationSeconds: 60,
      beatsPlanned: 2,
      segments: [],
    });
    exportMocks.pickBinaryExportFile.mockReset();
    exportMocks.pickBinaryExportFile.mockResolvedValue(null);
    exportMocks.saveExportBinary.mockReset();
    exportMocks.saveExportBinary.mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    vi.spyOn(window, "setInterval").mockImplementation(
      ((() =>
        1 as unknown as ReturnType<typeof window.setInterval>) as unknown) as typeof window.setInterval
    );
    vi.spyOn(window, "clearInterval").mockImplementation(
      ((_id: ReturnType<typeof window.setInterval>) => {}) as typeof window.clearInterval
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }),
    );
    vi.mocked(getOrCreateSwingBuffer).mockImplementation(
      (
        _sourceBuffer: AudioBuffer,
        _sourceIdentity: string | null,
        render: () => Promise<AudioBuffer>,
      ) => render(),
    );
    vi.mocked(renderSwingBuffer).mockResolvedValue({ duration: 4 } as AudioBuffer);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("switches between jukebox and autocanonizer UI modes", async () => {
    const rendered = renderListen();
    await settleEffects();

    const modeSelect = getRequired<HTMLSelectElement>(
      rendered.container,
      "#play-mode-select"
    );
    const tuningButton = getRequired<HTMLButtonElement>(
      rendered.container,
      "#tuning"
    );
    const infoButton = getRequired<HTMLButtonElement>(
      rendered.container,
      "#track-info"
    );
    const playTitle = rendered.container.querySelector(".play-title");

    expect(tuningButton.classList.contains("is-hidden")).toBe(false);
    expect(infoButton.classList.contains("is-hidden")).toBe(false);
    expect(playTitle?.textContent).toBe("song.wav");

    await changeSelect(modeSelect, "autocanonizer");

    expect(tuningButton.classList.contains("is-hidden")).toBe(true);
    expect(infoButton.classList.contains("is-hidden")).toBe(true);
    expect(playTitle?.textContent).toContain("(autocanonized)");
    const beatsLabelHidden = Array.from(
      rendered.container.querySelectorAll(".viz-meta span")
    ).some(
      (span) => span.textContent === "Total Beats:" && span.classList.contains("is-hidden")
    );
    expect(beatsLabelHidden).toBe(true);

    await changeSelect(modeSelect, "jukebox");

    expect(tuningButton.classList.contains("is-hidden")).toBe(false);
    expect(infoButton.classList.contains("is-hidden")).toBe(false);
    expect(playTitle?.textContent).toBe("song.wav");
    rendered.unmount();
  });

  it("loads and persists finish-out-song preference", async () => {
    window.localStorage.setItem("fj-canonizer-finish", "true");
    const rendered = renderListen();
    await settleEffects();

    const instance = autocanonizerInstances[0];
    expect(instance.setFinishOutSong).toHaveBeenCalledWith(true);

    const checkbox = rendered.container.querySelector(
      "#canonizer-finish"
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await click(checkbox);

    expect(window.localStorage.getItem("fj-canonizer-finish")).toBe("false");
    expect(instance.setFinishOutSong).toHaveBeenLastCalledWith(false);
    rendered.unmount();
  });

  it("opens sleep timer from the tuning header and applies only when set", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    const headerActions = getRequired<HTMLDivElement>(
      rendered.container,
      ".modal-header-actions",
    );
    const sleepTimerButton = getRequired<HTMLButtonElement>(
      headerActions,
      "#sleep-timer-open",
    );
    const closeButton = getRequired<HTMLButtonElement>(
      headerActions,
      ".modal-close",
    );
    expect(Array.from(headerActions.children)).toEqual([
      sleepTimerButton,
      closeButton,
    ]);

    await click(sleepTimerButton);
    const sleepTimerModal = getRequired<HTMLDivElement>(
      rendered.container,
      "#sleep-timer-modal",
    );
    const sleepTimerCurrent = getRequired<HTMLDivElement>(
      sleepTimerModal,
      "#sleep-timer-current",
    );
    const sleepTimerSelect = getRequired<HTMLSelectElement>(
      sleepTimerModal,
      "#sleep-timer-select",
    );
    expect(sleepTimerCurrent.textContent).toBe("Off");

    await changeSelect(sleepTimerSelect, "900000");
    await click(getRequired<HTMLButtonElement>(sleepTimerModal, "#sleep-timer-cancel"));
    expect(rendered.container.querySelector("#sleep-timer-modal")).toBe(null);

    await click(sleepTimerButton);
    const reopenedModal = getRequired<HTMLDivElement>(
      rendered.container,
      "#sleep-timer-modal",
    );
    const reopenedSelect = getRequired<HTMLSelectElement>(
      reopenedModal,
      "#sleep-timer-select",
    );
    expect(reopenedSelect.value).toBe("off");

    await changeSelect(reopenedSelect, "900000");
    await click(getRequired<HTMLButtonElement>(reopenedModal, "#sleep-timer-set"));
    expect(rendered.container.querySelector("#sleep-timer-modal")).toBe(null);

    await click(sleepTimerButton);
    const appliedModal = getRequired<HTMLDivElement>(
      rendered.container,
      "#sleep-timer-modal",
    );
    expect(
      getRequired<HTMLSelectElement>(appliedModal, "#sleep-timer-select").value,
    ).toBe("900000");
    expect(
      getRequired<HTMLDivElement>(appliedModal, "#sleep-timer-current").textContent,
    ).toBe("Current countdown: 00:15:00");
    rendered.unmount();
  });

  it("expires the sleep timer through the playback stop path", async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    await click(getRequired<HTMLButtonElement>(rendered.container, "#sleep-timer-open"));
    const sleepTimerModal = getRequired<HTMLDivElement>(
      rendered.container,
      "#sleep-timer-modal",
    );
    await changeSelect(
      getRequired<HTMLSelectElement>(sleepTimerModal, "#sleep-timer-select"),
      "900000",
    );
    await click(getRequired<HTMLButtonElement>(sleepTimerModal, "#sleep-timer-set"));

    const engine = engineInstances[0];
    if (!engine) {
      throw new Error("Expected jukebox engine instance");
    }
    engine.stopJukebox.mockClear();

    await act(async () => {
      nowMs = 900000;
      vi.advanceTimersByTime(1000);
    });

    expect(engine.stopJukebox).toHaveBeenCalledTimes(1);
    await click(getRequired<HTMLButtonElement>(rendered.container, "#sleep-timer-open"));
    const expiredModal = getRequired<HTMLDivElement>(
      rendered.container,
      "#sleep-timer-modal",
    );
    expect(
      getRequired<HTMLDivElement>(expiredModal, "#sleep-timer-current").textContent,
    ).toBe("Off");
    rendered.unmount();
  });

  it("supports play, pause, and resume controls", async () => {
    const rendered = renderListen();
    await settleEffects();

    const playButton = getRequired<HTMLButtonElement>(rendered.container, "#viz-play");

    expect(playButton.getAttribute("aria-label")).toBe("Play");

    await click(playButton);
    expect(playButton.getAttribute("aria-label")).toBe("Pause");

    await click(playButton);
    expect(playButton.getAttribute("aria-label")).toBe("Resume");

    await click(playButton);
    expect(playButton.getAttribute("aria-label")).toBe("Pause");

    rendered.unmount();
  });

  it("keeps jukebox running when audio ended fires during normal looping", async () => {
    const rendered = renderListen();
    await settleEffects();

    const playButton = getRequired<HTMLButtonElement>(rendered.container, "#viz-play");
    await click(playButton);
    expect(playButton.getAttribute("aria-label")).toBe("Pause");

    const player = playerInstances[0];
    if (!player) {
      throw new Error("Expected buffered player instance");
    }
    await act(async () => {
      player.emitEnded();
    });

    expect(playButton.getAttribute("aria-label")).toBe("Pause");
    rendered.unmount();
  });

  it("shows export modal with 2-hour max and compressed mp3 label", async () => {
    const rendered = renderListen();
    await settleEffects();

    const exportButton = getRequired<HTMLButtonElement>(
      rendered.container,
      "#track-audio-export"
    );
    await click(exportButton);

    const durationInput = getRequired<HTMLInputElement>(
      rendered.container,
      '.export-body input[type=\"number\"]'
    );
    expect(durationInput.max).toBe("7200");

    const formatSelect = getRequired<HTMLSelectElement>(
      rendered.container,
      ".export-body select"
    );
    const mp3Option = Array.from(formatSelect.options).find(
      (option) => option.value === "mp3"
    );
    expect(mp3Option?.textContent).toBe("MP3 (compressed)");
    expect(rendered.container.textContent).not.toContain(
      "Match Current Playback Exactly"
    );

    rendered.unmount();
  });

  it("passes the active extras audio mode to jukebox export", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    await click(getRequired<HTMLInputElement>(rendered.container, "#audio-mode-daycore"));
    await click(
      getRequired<HTMLButtonElement>(
        rendered.container,
        ".tuning-footer .tab-btn:last-child",
      ),
    );

    await click(getRequired<HTMLButtonElement>(rendered.container, "#track-audio-export"));
    await click(
      getRequired<HTMLButtonElement>(
        rendered.container,
        ".modal-footer .tab-btn:last-child",
      ),
    );
    await settleEffects();

    expect(exportMocks.exportJukeboxAudio).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportJukeboxAudio.mock.calls[0]?.[0]).toMatchObject({
      audioMode: "daycore",
      sectionStartBeatIndices: [],
    });
    rendered.unmount();
  });

  it("applies extras settings and updates title/url", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    const titleText = getRequired<HTMLSpanElement>(
      rendered.container,
      "#tuning-title-text"
    );
    const tuningTitle = getRequired<HTMLHeadingElement>(
      rendered.container,
      "#tuning-title"
    );
    const tabToggle = getRequired<HTMLButtonElement>(
      rendered.container,
      "#tuning-tab-toggle"
    );
    const tabToggleLabel = getRequired<HTMLSpanElement>(
      rendered.container,
      "#tuning-tab-toggle-label"
    );
    expect(titleText.textContent).toBe("Tuning");
    expect(tuningTitle.classList.contains("is-extras-active")).toBe(false);
    expect(tabToggle.classList.contains("hidden")).toBe(false);
    expect(tabToggleLabel.textContent).toBe("Extras");
    expect(tabToggle.getAttribute("aria-label")).toBe("Switch to Extras");

    await switchToExtrasTab(rendered.container);
    expect(titleText.textContent).toBe("Extras");
    expect(tuningTitle.classList.contains("is-extras-active")).toBe(true);
    expect(tabToggle.classList.contains("hidden")).toBe(false);
    expect(tabToggleLabel.textContent).toBe("Tuning");
    expect(tabToggle.getAttribute("aria-label")).toBe("Switch to Tuning");
    expect(rendered.container.querySelector("#tuning-beta-tag")).toBeNull();

    const branchStatsInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#extras-enabled"
    );
    await click(branchStatsInput);
    const bringHomeInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#bring-home-enabled"
    );
    await click(bringHomeInput);
    const daycoreInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-daycore"
    );
    await click(daycoreInput);

    const footerButtons = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>(".tuning-footer .tab-btn")
    );
    await click(footerButtons[1] as HTMLButtonElement);

    expect(window.localStorage.getItem("fj-branch-stats-enabled")).toBe("1");
    const playTitle = getRequired<HTMLDivElement>(rendered.container, ".play-title");
    expect(playTitle.textContent).toContain("(daycore)");
    expect(rendered.container.textContent).toContain("Bringing it on home");
    expect(window.location.search).toContain("am=daycore");
    rendered.unmount();
  });

  it("resumes jukebox playback after preparing swing while already running", async () => {
    const rendered = renderListen();
    await settleEffects();

    const playButton = getRequired<HTMLButtonElement>(rendered.container, "#viz-play");
    await click(playButton);
    expect(playButton.getAttribute("aria-label")).toBe("Pause");

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    await click(getRequired<HTMLInputElement>(rendered.container, "#audio-mode-swing"));
    const footerButtons = Array.from(
      rendered.container.querySelectorAll<HTMLButtonElement>(".tuning-footer .tab-btn")
    );
    await click(footerButtons[1] as HTMLButtonElement);
    await settleEffects();

    const engine = engineInstances[0];
    if (!engine) {
      throw new Error("Expected jukebox engine instance");
    }
    expect(engine.pauseJukebox).toHaveBeenCalledTimes(1);
    expect(engine.startJukebox).toHaveBeenLastCalledWith(false);
    expect(engine.play).toHaveBeenCalledTimes(2);
    expect(playButton.getAttribute("aria-label")).toBe("Pause");
    expect(window.location.search).toContain("am=swing");
    rendered.unmount();
  });

  it("opens extras tab with E keyboard shortcut", async () => {
    const rendered = renderListen();
    await settleEffects();

    await keydown("e", "KeyE");

    const titleText = getRequired<HTMLSpanElement>(
      rendered.container,
      "#tuning-title-text"
    );
    expect(titleText.textContent).toBe("Extras");
    const tuningTitle = getRequired<HTMLHeadingElement>(
      rendered.container,
      "#tuning-title"
    );
    expect(tuningTitle.classList.contains("is-extras-active")).toBe(true);
    const tabToggle = getRequired<HTMLButtonElement>(
      rendered.container,
      "#tuning-tab-toggle"
    );
    const tabToggleLabel = getRequired<HTMLSpanElement>(
      rendered.container,
      "#tuning-tab-toggle-label"
    );
    expect(tabToggle.classList.contains("hidden")).toBe(false);
    expect(tabToggleLabel.textContent).toBe("Tuning");
    const tuningPanel = getRequired<HTMLDivElement>(
      rendered.container,
      "#tuning-panel-tuning"
    );
    const extrasPanel = getRequired<HTMLDivElement>(
      rendered.container,
      "#tuning-panel-extras"
    );
    expect(tuningPanel.classList.contains("hidden")).toBe(true);
    expect(extrasPanel.classList.contains("hidden")).toBe(false);
    await click(tabToggle);
    expect(titleText.textContent).toBe("Tuning");
    expect(tuningTitle.classList.contains("is-extras-active")).toBe(false);
    expect(tabToggleLabel.textContent).toBe("Extras");
    expect(tuningPanel.classList.contains("hidden")).toBe(false);
    expect(extrasPanel.classList.contains("hidden")).toBe(true);
    rendered.unmount();
  });

  it("sets and clears the selected backward branch as the user anchor with A", async () => {
    const rendered = renderListen();
    await settleEffects();

    const controller = jukeboxControllerInstances[0];
    const engine = engineInstances[0];
    if (!controller || !engine) {
      throw new Error("Expected jukebox controller and engine instances");
    }
    const edge = {
      id: 7,
      deleted: false,
      src: { start: 12, which: 12 },
      dest: { start: 4, which: 4 },
      distance: 8,
    };
    controller.setData.mockClear();
    controller.setSelectedEdgeActive.mockClear();
    await act(async () => {
      controller.emitEdgeSelect(edge);
    });

    await keydown("A", "KeyA");

    expect(engine.setUserAnchorEdge).toHaveBeenCalledWith(edge);
    expect(controller.setData).toHaveBeenCalled();
    expect(controller.setSelectedEdgeActive).toHaveBeenCalledWith(edge);
    expect(rendered.container.textContent).toContain("Anchor branch set");

    engine.getUserAnchorEdgeId.mockReturnValue(edge.id);
    await keydown("a", "KeyA");

    expect(engine.setUserAnchorEdge).toHaveBeenLastCalledWith(null);
    expect(rendered.container.textContent).toContain("Anchor branch reset");
    rendered.unmount();
  });

  it("ignores A for a selected forward branch", async () => {
    const rendered = renderListen();
    await settleEffects();

    const controller = jukeboxControllerInstances[0];
    const engine = engineInstances[0];
    if (!controller || !engine) {
      throw new Error("Expected jukebox controller and engine instances");
    }
    await act(async () => {
      controller.emitEdgeSelect({
        id: 8,
        deleted: false,
        src: { start: 4, which: 4 },
        dest: { start: 12, which: 12 },
        distance: 8,
      });
    });

    await keydown("A", "KeyA");

    expect(engine.setUserAnchorEdge).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("hides visible branch stats popup when branch stats is disabled", async () => {
    window.localStorage.setItem("fj-branch-stats-enabled", "1");
    const rendered = renderListen();
    await settleEffects();

    const controller = jukeboxControllerInstances[0];
    if (!controller) {
      throw new Error("Expected jukebox controller instance");
    }
    await act(async () => {
      controller.emitEdgeSelect({
        id: 7,
        src: { start: 10, which: 10 },
        dest: { start: 20, which: 20 },
        distance: 10,
      });
    });
    expect(rendered.container.querySelector(".branch-stats-popup")).not.toBeNull();

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    const branchStatsInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#extras-enabled"
    );
    expect(branchStatsInput.checked).toBe(true);
    await click(branchStatsInput);
    const applyButton = getRequired<HTMLButtonElement>(
      rendered.container,
      ".tuning-footer .tab-btn:last-child"
    );
    await click(applyButton);

    expect(rendered.container.querySelector(".branch-stats-popup")).toBeNull();
    rendered.unmount();
  });

  it("deletes selected branch from branch stats popup delete button", async () => {
    window.localStorage.setItem("fj-branch-stats-enabled", "1");
    const rendered = renderListen();
    await settleEffects();

    const controller = jukeboxControllerInstances[0];
    if (!controller) {
      throw new Error("Expected jukebox controller instance");
    }
    await act(async () => {
      controller.emitEdgeSelect({
        id: 9,
        deleted: false,
        src: { start: 12, which: 12 },
        dest: { start: 24, which: 24 },
        distance: 8,
      });
    });

    const deleteButton = getRequired<HTMLButtonElement>(
      rendered.container,
      "#branch-stats-delete"
    );
    await click(deleteButton);

    expect(rendered.container.querySelector(".branch-stats-popup")).toBeNull();
    rendered.unmount();
  });

  it("resets only extras settings when reset is clicked from extras tab", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    await click(getRequired<HTMLInputElement>(rendered.container, "#extras-enabled"));
    await click(getRequired<HTMLInputElement>(rendered.container, "#bring-home-enabled"));
    await click(getRequired<HTMLInputElement>(rendered.container, "#audio-mode-daycore"));
    await click(
      getRequired<HTMLButtonElement>(rendered.container, ".tuning-footer .tab-btn:last-child")
    );

    expect(window.localStorage.getItem("fj-branch-stats-enabled")).toBe("1");
    expect(
      getRequired<HTMLDivElement>(rendered.container, ".play-title").textContent
    ).toContain("(daycore)");
    expect(rendered.container.textContent).toContain("Bringing it on home");

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    await click(
      getRequired<HTMLButtonElement>(rendered.container, ".tuning-footer .tab-btn:first-child")
    );

    expect(window.localStorage.getItem("fj-branch-stats-enabled")).toBe("0");
    expect(
      getRequired<HTMLDivElement>(rendered.container, ".play-title").textContent
    ).not.toContain("(daycore)");
    expect(rendered.container.textContent).not.toContain("Bringing it on home");
    rendered.unmount();
  });

  it("resets audio mode when switching to a different track", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    const daycoreInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-daycore"
    );
    await click(daycoreInput);
    const applyButton = getRequired<HTMLButtonElement>(
      rendered.container,
      ".tuning-footer .tab-btn:last-child"
    );
    await click(applyButton);

    const playTitle = getRequired<HTMLDivElement>(rendered.container, ".play-title");
    expect(playTitle.textContent).toContain("(daycore)");
    expect(window.location.search).toContain("am=daycore");

    mockAppState.file = new File([new Uint8Array([9, 9, 9])], "song-two.wav", {
      lastModified: 9999,
    });
    rendered.rerender();
    await settleEffects();

    const player = playerInstances[0];
    if (!player) {
      throw new Error("Expected buffered player instance");
    }
    expect(player.getAudioMode()).toBe("off");
    expect(window.location.search).not.toContain("am=daycore");
    rendered.unmount();
  });

  it("keeps tuning changes unapplied when applying extras tab only", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    const thresholdInput = getRequired<HTMLInputElement>(
      rendered.container,
      '#tuning-panel-tuning input[type="range"]'
    );
    await act(async () => {
      thresholdInput.value = "55";
      thresholdInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await switchToExtrasTab(rendered.container);
    const nightcoreInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-nightcore"
    );
    await click(nightcoreInput);
    const applyButton = getRequired<HTMLButtonElement>(
      rendered.container,
      ".tuning-footer .tab-btn:last-child"
    );
    await click(applyButton);

    await openTuningModal(rendered.container);
    const thresholdValue = getRequired<HTMLSpanElement>(
      rendered.container,
      "#tuning-panel-tuning .label-line span"
    );
    expect(thresholdValue.textContent).toBe("20");
    rendered.unmount();
  });

  it("loads audio mode from url params into title and extras radios", async () => {
    window.history.replaceState({}, "", "/?am=vaporwave");
    const rendered = renderListen();
    await settleEffects();

    const playTitle = getRequired<HTMLDivElement>(rendered.container, ".play-title");
    expect(playTitle.textContent).toContain("(vaporwave)");

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);
    const vaporwaveInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-vaporwave"
    );
    expect(vaporwaveInput.checked).toBe(true);
    rendered.unmount();
  });

  it("maps audio mode hover text correctly", async () => {
    const rendered = renderListen();
    await settleEffects();

    await openTuningModal(rendered.container);
    await switchToExtrasTab(rendered.container);

    const offInput = getRequired<HTMLInputElement>(rendered.container, "#audio-mode-off");
    const nightcoreInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-nightcore"
    );
    const daycoreInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-daycore"
    );
    const vaporwaveInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-vaporwave"
    );
    const eightDInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-eight-d"
    );
    const lofiInput = getRequired<HTMLInputElement>(rendered.container, "#audio-mode-lofi");
    const cowbellInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-cowbell"
    );
    const swingInput = getRequired<HTMLInputElement>(
      rendered.container,
      "#audio-mode-swing"
    );

    expect(offInput.title).toBe("");
    expect(nightcoreInput.title).toBe("Fast & Bright");
    expect(daycoreInput.title).toBe("Slow & Deep");
    expect(vaporwaveInput.title).toBe("Muffled & Slow");
    expect(eightDInput.title).toBe("Spinning/Spatial");
    expect(lofiInput.title).toBe("Radio Filter");
    expect(cowbellInput.title).toBe("More Cowbell");
    expect(swingInput.title).toBe("Adds a loping swung feel to each beat");
    rendered.unmount();
  });
});
