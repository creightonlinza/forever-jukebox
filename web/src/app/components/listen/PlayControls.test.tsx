import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CANONIZER_FINISH_KEY } from "../../constants";
import { useAppStore } from "../../store";
import { PlayControls } from "./PlayControls";
import { VizTop } from "./VizTop";

const h = vi.hoisted(() => ({
  togglePlayback: vi.fn(),
  playlistPrevious: vi.fn(),
  playlistNext: vi.fn(),
  setPlayMode: vi.fn(),
  setActiveVisualization: vi.fn(),
  setCanonizerFinish: vi.fn(),
  jukebox: { getCount: vi.fn(() => 6) },
}));

vi.mock("../../playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback")>()),
  togglePlayback: h.togglePlayback,
}));
vi.mock("../../playlist-actions", () => ({
  playlistPrevious: h.playlistPrevious,
  playlistNext: h.playlistNext,
}));
vi.mock("../../playback-ui", () => ({
  setPlayMode: h.setPlayMode,
  setActiveVisualization: h.setActiveVisualization,
  setCanonizerFinish: h.setCanonizerFinish,
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => ({ jukebox: h.jukebox })),
}));

const tracks = [
  { id: "a", sourceType: "youtube" as const, title: "A", artist: "", duration: null },
  { id: "b", sourceType: "youtube" as const, title: "B", artist: "", duration: null },
];

describe("PlayControls", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        isRunning: false,
        isPaused: false,
        playMode: "jukebox",
        jukeboxAudioMode: "off",
        swingPreparing: false,
        audioLoaded: true,
        analysisLoaded: true,
        audioLoadInFlight: false,
        analysisPollInFlight: false,
        playlistLoadBusy: false,
        playlist: { tracks: [], currentIndex: -1 },
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders play/pause/resume labels from playback state", () => {
    render(<PlayControls />);
    const button = document.getElementById("viz-play")!;
    expect(button.getAttribute("aria-label")).toBe("Play");
    expect(button.querySelector(".play-icon")?.textContent).toBe("play_arrow");
    act(() => {
      useAppStore.setState({ isRunning: true });
    });
    expect(button.getAttribute("aria-label")).toBe("Pause");
    expect(button.querySelector(".play-icon")?.textContent).toBe("pause");
    act(() => {
      useAppStore.setState({ isRunning: false, isPaused: true });
    });
    expect(button.getAttribute("aria-label")).toBe("Resume");
  });

  it("blocks and hides while swing is preparing", () => {
    render(<PlayControls />);
    const button = document.getElementById("viz-play") as HTMLButtonElement;
    act(() => {
      useAppStore.setState({ jukeboxAudioMode: "swing", swingPreparing: true });
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Preparing Swing mode");
    expect(button.classList.contains("hidden")).toBe(true);
  });

  it("toggles playback on click", async () => {
    render(<PlayControls />);
    await userEvent.click(document.getElementById("viz-play")!);
    expect(h.togglePlayback).toHaveBeenCalled();
  });

  it("shows playlist prev/next for active playlists and disables while busy", async () => {
    render(<PlayControls />);
    const prev = document.getElementById("playlist-previous") as HTMLButtonElement;
    const next = document.getElementById("playlist-next") as HTMLButtonElement;
    expect(prev.classList.contains("is-hidden")).toBe(true);
    act(() => {
      useAppStore.setState({ playlist: { tracks, currentIndex: 0 } });
    });
    expect(prev.classList.contains("is-hidden")).toBe(false);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    await userEvent.click(next);
    expect(h.playlistNext).toHaveBeenCalled();
    act(() => {
      useAppStore.setState({ playlistLoadBusy: true });
    });
    expect(next.disabled).toBe(true);
  });
});

describe("VizTop", () => {
  beforeEach(() => {
    localStorage.removeItem(CANONIZER_FINISH_KEY);
    act(() => {
      useAppStore.setState({
        playMode: "jukebox",
        activeVizIndex: 1,
        audioLoaded: true,
        analysisLoaded: true,
        swingPreparing: false,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sorted visualization options with the active value", () => {
    render(<VizTop />);
    const select = document.getElementById("viz-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Arc",
      "Classic",
      "Galaxy",
      "Grid",
      "Infinite",
      "Wave",
    ]);
    expect(select.value).toBe("1");
    expect(select.disabled).toBe(false);
  });

  it("disables the viz select in autocanonizer mode and forwards changes", async () => {
    render(<VizTop />);
    const select = document.getElementById("viz-select") as HTMLSelectElement;
    await userEvent.selectOptions(select, "4");
    expect(h.setActiveVisualization).toHaveBeenCalledWith(4);
    act(() => {
      useAppStore.setState({ playMode: "autocanonizer" });
    });
    expect(select.disabled).toBe(true);
  });

  it("switches play mode", async () => {
    render(<VizTop />);
    await userEvent.selectOptions(
      document.getElementById("play-mode-select")!,
      "autocanonizer",
    );
    expect(h.setPlayMode).toHaveBeenCalledWith("autocanonizer");
  });

  it("persists the canonizer finish checkbox via the bridge", async () => {
    render(<VizTop />);
    const checkbox = document.getElementById(
      "canonizer-finish",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await userEvent.click(checkbox);
    expect(h.setCanonizerFinish).toHaveBeenCalledWith(true);
    expect(checkbox.checked).toBe(true);
  });
});
