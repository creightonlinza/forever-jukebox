import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JukeboxEngine, type JukeboxPlayer } from "@forever-jukebox/shared";
import type { AppContext } from "../context";
import { useAppStore } from "../store";
import { setWindowUrl } from "../__tests__/test-utils";
import {
  exitCustomAnchorEdit,
  handleAnchorEditCommit,
  nudgeCustomAnchor,
  resetCustomAnchor,
  startCustomAnchorEdit,
} from "./custom-anchor";

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(() => true),
    cancelScheduledJump: vi.fn(),
    getCurrentTime: () => 0,
    getAudioTime: () => 0,
    getPlaybackRate: () => 1,
    isPlaying: () => false,
  };
}

function makeAnalysis(count: number) {
  const beats = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
  }));
  const bars = Array.from({ length: Math.ceil(count / 4) }, (_, i) => ({
    start: i * 4,
    duration: 4,
    confidence: 1,
  }));
  return {
    sections: [{ start: 0, duration: count, confidence: 1 }],
    bars,
    beats,
    tatums: beats,
    segments: beats.map((beat, i) => ({
      ...beat,
      loudness_start: -20,
      loudness_max: -10,
      loudness_max_time: 0.1,
      pitches: Array.from({ length: 12 }, (_v, p) => ((i + p) % 12) / 12),
      timbre: Array.from({ length: 12 }, (_v, t) => ((i * 7 + t) % 13) * 3),
    })),
    track: { duration: count },
  };
}

function makeContext(count = 40) {
  const engine = new JukeboxEngine(makePlayer());
  engine.loadAnalysis(makeAnalysis(count));
  const jukebox = { setAnchorEdit: vi.fn(), setData: vi.fn(), setSelectedEdge: vi.fn() };
  const context = {
    engine,
    jukebox,
    player: { getDuration: () => count },
    defaultConfig: engine.getConfig(),
  } as unknown as AppContext;
  useAppStore.setState({
    playMode: "jukebox",
    analysisLoaded: true,
    vizData: engine.getVisualizationData(),
  });
  return { context, engine, jukebox };
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
  setWindowUrl("http://localhost/listen/abc");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("custom anchor editor", () => {
  it("opens on the anchor in force and clears the branch selection", () => {
    const { context, engine, jukebox } = makeContext();
    const active = engine.getActiveAnchor();
    expect(startCustomAnchorEdit(context)).toBe(true);
    const edit = useAppStore.getState().customAnchorEdit;
    if (active) {
      expect(edit).toMatchObject(active);
    } else {
      expect(edit).toEqual({ src: 39, dest: 0, active: "src" });
    }
    expect(jukebox.setSelectedEdge).toHaveBeenCalledWith(null);
    expect(jukebox.setAnchorEdit).toHaveBeenLastCalledWith(edit);
  });

  it("refuses a track too short for the minimum gap", () => {
    const { context } = makeContext(4);
    expect(startCustomAnchorEdit(context)).toBe(false);
    expect(useAppStore.getState().customAnchorEdit).toBeNull();
  });

  it("commits a drag to the engine and the URL", () => {
    const { context, engine } = makeContext();
    startCustomAnchorEdit(context);
    handleAnchorEditCommit(context, { src: 30, dest: 10, active: "dest" });
    expect(engine.getCustomAnchor()).toEqual({ src: 30, dest: 10 });
    expect(window.location.search).toContain("ca=30-10");
  });

  it("commits key nudges once they settle, by beat or by bar", () => {
    vi.useFakeTimers();
    const { context, engine } = makeContext();
    startCustomAnchorEdit(context);
    handleAnchorEditCommit(context, { src: 30, dest: 10, active: "src" });
    nudgeCustomAnchor(context, 1, false);
    nudgeCustomAnchor(context, 1, true);
    expect(useAppStore.getState().customAnchorEdit).toMatchObject({ src: 35, dest: 10 });
    expect(engine.getCustomAnchor()).toEqual({ src: 30, dest: 10 });
    vi.advanceTimersByTime(300);
    expect(engine.getCustomAnchor()).toEqual({ src: 35, dest: 10 });
  });

  it("lands a pending nudge when the editor closes", () => {
    vi.useFakeTimers();
    const { context, engine, jukebox } = makeContext();
    startCustomAnchorEdit(context);
    handleAnchorEditCommit(context, { src: 30, dest: 10, active: "dest" });
    nudgeCustomAnchor(context, -1, false);
    exitCustomAnchorEdit(context);
    expect(engine.getCustomAnchor()).toEqual({ src: 30, dest: 9 });
    expect(useAppStore.getState().customAnchorEdit).toBeNull();
    expect(jukebox.setAnchorEdit).toHaveBeenLastCalledWith(null);
  });

  it("ignores a commit after the editor has closed", () => {
    const { context, engine } = makeContext();
    handleAnchorEditCommit(context, { src: 30, dest: 10, active: "src" });
    expect(engine.getCustomAnchor()).toBeNull();
  });

  it("resets to the default anchor and keeps editing", () => {
    const { context, engine } = makeContext();
    startCustomAnchorEdit(context);
    handleAnchorEditCommit(context, { src: 30, dest: 10, active: "src" });
    resetCustomAnchor(context);
    expect(engine.getCustomAnchor()).toBeNull();
    expect(window.location.search).not.toContain("ca=");
    expect(useAppStore.getState().customAnchorEdit).not.toBeNull();
  });
});
