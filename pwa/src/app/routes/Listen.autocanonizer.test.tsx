import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Listen } from "./Listen";

const mockAppState = {
  file: null as File | null,
  setIsListenLoading: vi.fn<(loading: boolean) => void>(),
};

type MockAutocanonizerInstance = {
  setFinishOutSong: ReturnType<typeof vi.fn>;
};

const autocanonizerInstances: MockAutocanonizerInstance[] = [];

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
    async loadBuffer(_buffer: AudioBuffer) {}
    getContext() {
      return {} as AudioContext;
    }
    setOnEnded(_handler: (() => void) | null) {}
    getBuffer() {
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
    async dispose() {}
  },
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
    constructor(_player: unknown) {}
    loadAnalysis(data: typeof mockAnalysis) {
      this.analysis = data;
    }
    onUpdate(_listener: (state: any) => void) {}
    stopJukebox() {}
    resetStats() {}
    startJukebox(_reset = true) {}
    play() {}
    seekToBeat(_index: number) {}
    setForceBranch(_enabled: boolean) {}
    setBringItHomeMode(_enabled: boolean) {}
    deleteEdge(_edge: unknown) {}
    rebuildGraph() {}
    clearDeletedEdges() {}
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
  },
}));

vi.mock("@/shared/jukebox/viz/JukeboxController", () => ({
  JukeboxController: class JukeboxController {
    constructor(_layer: HTMLElement) {}
    setActiveIndex(_index: number) {}
    setVisible(_visible: boolean) {}
    setAnchorHighlightEnabled(_enabled: boolean) {}
    resizeActive() {}
    reset() {}
    setData(_data: unknown) {}
    setOnSelect(_handler: (index: number) => void) {}
    setOnEdgeSelect(_handler: (edge: unknown) => void) {}
    setSelectedEdge(_edge: unknown) {}
    setSelectedEdgeActive(_edge: unknown) {}
    update(_index: number, _animate: boolean, _jumpFrom: number | null) {}
    destroy() {}
    getCount() {
      return 2;
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

describe("Listen autocanonizer behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    autocanonizerInstances.length = 0;
    mockAppState.file = new File([new Uint8Array([1, 2, 3])], "song.wav", {
      lastModified: 1234,
    });
    mockAppState.setIsListenLoading.mockReset();
    window.localStorage.clear();
    vi.spyOn(window, "setInterval").mockImplementation(
      ((() =>
        1 as unknown as ReturnType<typeof window.setInterval>) as unknown) as typeof window.setInterval
    );
    vi.spyOn(window, "clearInterval").mockImplementation(
      ((_id: ReturnType<typeof window.setInterval>) => {}) as typeof window.clearInterval
    );
  });

  afterEach(() => {
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
});
