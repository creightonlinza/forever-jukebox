import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import { useAppStore } from "../store";
import type { InstrumentalProgress } from "@forever-jukebox/shared/audio/instrumentalRenderer";

// The render hands back a promise settled by hand so store state can change
// mid-render before the completion guards run.
let resolveRender!: (buffer: AudioBuffer) => void;
let rejectRender!: (err: Error) => void;
let reportProgress!: (progress: InstrumentalProgress) => void;
const renderInstrumentalBuffer = vi.fn(
  (
    _source: AudioBuffer,
    _trackId: string | null,
    onProgress: (progress: InstrumentalProgress) => void,
  ) => {
    reportProgress = onProgress;
    return new Promise<AudioBuffer>((resolve, reject) => {
      resolveRender = resolve;
      rejectRender = reject;
    });
  },
);

vi.mock("@forever-jukebox/shared/audio/instrumentalRenderer", () => ({
  renderInstrumentalBuffer: (
    source: AudioBuffer,
    trackId: string | null,
    onProgress: (progress: InstrumentalProgress) => void,
  ) => renderInstrumentalBuffer(source, trackId, onProgress),
}));
const resetAudioModeToOff = vi.fn(() => {
  useAppStore.setState({ jukeboxAudioMode: "off" });
});
vi.mock("../tuning", () => ({
  resetAudioModeToOff: () => resetAudioModeToOff(),
  syncTuningParamsState: vi.fn(() => null),
  writeTuningParamsToUrl: vi.fn(),
}));
const showToast = vi.fn();
vi.mock("../ui", () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));
vi.mock("./status-ui", () => ({
  updatePlayButton: vi.fn(),
  updateVizVisibility: vi.fn(),
}));

const pausePlayback = vi.fn((_context: AppContext) => {
  // Mirror the real transport: a pause leaves isPaused set.
  useAppStore.setState({ isRunning: false, isPaused: true });
});
const startJukeboxPlayback = vi.fn();
vi.mock("./transport", () => ({
  pausePlayback: (context: AppContext) => pausePlayback(context),
  startJukeboxPlayback: (context: AppContext, reset: boolean) =>
    startJukeboxPlayback(context, reset),
}));

import {
  canPrepareInstrumentalMode,
  maybePrepareInstrumentalMode,
  prepareInstrumentalMode,
} from "./instrumental";

const initialStoreState = useAppStore.getState();
const renderedBuffer = { duration: 10 } as AudioBuffer;

async function flushMicrotasks(count = 5) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

function createContext() {
  return {
    player: {
      getSourceBuffer: vi.fn(() => ({ duration: 10 }) as AudioBuffer),
      setRenderedJukeboxAudioBuffer: vi.fn(),
      setJukeboxAudioMode: vi.fn(),
    },
    engine: { syncToPlaybackPosition: vi.fn() },
  } as unknown as AppContext;
}

describe("prepareInstrumentalMode", () => {
  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({
      jukeboxAudioMode: "instrumental",
      playMode: "jukebox",
      audioLoaded: true,
      analysisLoaded: true,
      isRunning: true,
      isPaused: false,
      audioModeRenderToken: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("swaps in the rendered buffer and resumes when only prepare paused", async () => {
    const context = createContext();
    prepareInstrumentalMode(context);
    expect(useAppStore.getState().audioModePreparing).toBe(true);
    expect(useAppStore.getState().isPaused).toBe(true);

    resolveRender(renderedBuffer);
    await flushMicrotasks();

    expect(context.player.setRenderedJukeboxAudioBuffer).toHaveBeenCalledWith(
      "instrumental",
      renderedBuffer,
    );
    expect(context.player.setJukeboxAudioMode).toHaveBeenCalledWith(
      "instrumental",
    );
    expect(context.engine.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().audioModePreparing).toBe(false);
    expect(startJukeboxPlayback).toHaveBeenCalledTimes(1);
  });

  it("keys the stored instrumental by the current track", () => {
    useAppStore.setState({ lastTrackId: "track-1", lastJobId: "job-1" });
    prepareInstrumentalMode(createContext());
    expect(renderInstrumentalBuffer.mock.calls[0][1]).toBe("track-1");
  });

  it("does not resume when the sleep timer stopped playback mid-render", async () => {
    prepareInstrumentalMode(createContext());
    useAppStore.setState({ isRunning: false, isPaused: false });
    resolveRender(renderedBuffer);
    await flushMicrotasks();
    expect(startJukeboxPlayback).not.toHaveBeenCalled();
  });

  it("reports each phase in the status panel", () => {
    prepareInstrumentalMode(createContext());

    reportProgress({ phase: "download", progress: 0.256 });
    expect(useAppStore.getState().analysisProgressText).toBe("26%");
    expect(useAppStore.getState().analysisStatusText()).toBe(
      "Downloading the instrumental model...",
    );

    reportProgress({ phase: "separate", progress: 2 });
    expect(useAppStore.getState().analysisProgressText).toBe("100%");
    expect(useAppStore.getState().analysisStatusText()).toBe(
      "Removing vocals from the track...",
    );
  });

  it("ignores a render superseded by a newer token", async () => {
    const context = createContext();
    prepareInstrumentalMode(context);
    useAppStore.setState({
      audioModeRenderToken: useAppStore.getState().audioModeRenderToken + 1,
    });

    reportProgress({ phase: "separate", progress: 0.5 });
    resolveRender(renderedBuffer);
    await flushMicrotasks();

    expect(useAppStore.getState().analysisProgressText).toBe("");
    expect(context.player.setRenderedJukeboxAudioBuffer).not.toHaveBeenCalled();
    expect(startJukeboxPlayback).not.toHaveBeenCalled();
  });

  it("stays silent when the render rejects after the mode changed", async () => {
    prepareInstrumentalMode(createContext());
    useAppStore.setState({ jukeboxAudioMode: "nightcore" });

    rejectRender(new Error("Instrumental render cancelled"));
    await flushMicrotasks();

    expect(showToast).not.toHaveBeenCalled();
    expect(resetAudioModeToOff).not.toHaveBeenCalled();
  });

  it("falls back to normal mode when the render fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    prepareInstrumentalMode(createContext());

    rejectRender(new Error("WebGPU adapter unavailable"));
    await flushMicrotasks();

    expect(resetAudioModeToOff).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().audioModePreparing).toBe(false);
    expect(useAppStore.getState().analysisSpinning).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Instrumental mode failed. Using Normal mode.",
      { icon: "error", tone: "error" },
    );
    expect(startJukeboxPlayback).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does nothing when another mode is selected", () => {
    useAppStore.setState({ jukeboxAudioMode: "swing" });
    prepareInstrumentalMode(createContext());
    expect(renderInstrumentalBuffer).not.toHaveBeenCalled();
    expect(useAppStore.getState().audioModePreparing).toBe(false);
  });
});

describe("maybePrepareInstrumentalMode", () => {
  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({
      jukeboxAudioMode: "instrumental",
      playMode: "jukebox",
      audioLoaded: true,
      analysisLoaded: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("waits until both audio and analysis are loaded", () => {
    const context = createContext();
    useAppStore.setState({ analysisLoaded: false });
    expect(canPrepareInstrumentalMode(context)).toBe(false);
    maybePrepareInstrumentalMode(context);
    expect(renderInstrumentalBuffer).not.toHaveBeenCalled();

    useAppStore.setState({ analysisLoaded: true });
    maybePrepareInstrumentalMode(context);
    expect(renderInstrumentalBuffer).toHaveBeenCalledTimes(1);
  });

  it("skips autocanonizer play mode", () => {
    useAppStore.setState({ playMode: "autocanonizer" });
    maybePrepareInstrumentalMode(createContext());
    expect(renderInstrumentalBuffer).not.toHaveBeenCalled();
  });
});
