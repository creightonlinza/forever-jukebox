import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import { useAppStore } from "../store";

// Control the swing render: getOrCreateSwingBuffer hands back a promise we
// resolve by hand so we can mutate store state mid-render (as the sleep timer
// would) before the resume guard runs.
let resolveRender!: (buffer: AudioBuffer) => void;
const getOrCreateSwingBuffer = vi.fn(
  (..._args: unknown[]) =>
    new Promise<AudioBuffer>((resolve) => {
      resolveRender = resolve;
    }),
);

vi.mock("@forever-jukebox/engine/audio/swingBufferCache", () => ({
  getOrCreateSwingBuffer: (...args: unknown[]) =>
    getOrCreateSwingBuffer(...args),
}));
vi.mock("@forever-jukebox/engine/audio/swingRenderer", () => ({
  renderSwingBuffer: vi.fn(),
}));
vi.mock("../tuning", () => ({
  syncTuningParamsState: vi.fn(() => null),
  writeTuningParamsToUrl: vi.fn(),
}));
vi.mock("../ui", () => ({ showToast: vi.fn() }));
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

import { prepareSwingMode } from "./swing";

const initialStoreState = useAppStore.getState();
const renderedBuffer = { duration: 10 } as AudioBuffer;

async function flushMicrotasks(count = 5) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

function createContext(): AppContext {
  return {
    player: {
      getSourceBuffer: () => ({ duration: 10 }) as AudioBuffer,
      setRenderedJukeboxAudioBuffer: vi.fn(),
      setJukeboxAudioMode: vi.fn(),
    },
    engine: { syncToPlaybackPosition: vi.fn() },
  } as unknown as AppContext;
}

describe("prepareSwingMode resume guard", () => {
  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({
      jukeboxAudioMode: "swing",
      playMode: "jukebox",
      isRunning: true,
      isPaused: false,
      swingRenderToken: 0,
      vizData: { beats: [{}, {}] } as never,
    });
    startJukeboxPlayback.mockClear();
    pausePlayback.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resumes playback after the render when only prepare paused", async () => {
    prepareSwingMode(createContext());
    // prepare's own pause set isPaused; nothing cleared it.
    expect(useAppStore.getState().isPaused).toBe(true);
    resolveRender(renderedBuffer);
    await flushMicrotasks();
    expect(startJukeboxPlayback).toHaveBeenCalledTimes(1);
  });

  it("does not resume when the sleep timer stopped playback mid-render", async () => {
    prepareSwingMode(createContext());
    // The sleep timer's stopPlayback runs during the render: it clears isPaused.
    useAppStore.setState({ isRunning: false, isPaused: false });
    resolveRender(renderedBuffer);
    await flushMicrotasks();
    expect(startJukeboxPlayback).not.toHaveBeenCalled();
  });
});
