import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppBridge } from "../../bridge";
import { useAppStore } from "../../store";
import { PlayControls } from "./PlayControls";
import { VizTop } from "./VizTop";

function createBridge() {
  return {
    context: {
      jukebox: { getCount: vi.fn(() => 6) },
    },
    listenPanel: {
      togglePlayback: vi.fn(),
      setPlayMode: vi.fn(),
      setActiveVisualization: vi.fn(),
      setCanonizerFinish: vi.fn(),
      playlistPrevious: vi.fn(),
      playlistNext: vi.fn(),
    },
  } as unknown as AppBridge;
}

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
        pollController: null,
        playlistLoadBusy: false,
        playlist: { tracks: [], currentIndex: -1 },
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders play/pause/resume labels from playback state", () => {
    render(<PlayControls bridge={createBridge()} />);
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
    render(<PlayControls bridge={createBridge()} />);
    const button = document.getElementById("viz-play") as HTMLButtonElement;
    act(() => {
      useAppStore.setState({ jukeboxAudioMode: "swing", swingPreparing: true });
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Preparing Swing mode");
    expect(button.classList.contains("hidden")).toBe(true);
  });

  it("toggles playback on click", async () => {
    const bridge = createBridge();
    render(<PlayControls bridge={bridge} />);
    await userEvent.click(document.getElementById("viz-play")!);
    expect(bridge.listenPanel.togglePlayback).toHaveBeenCalled();
  });

  it("shows playlist prev/next for active playlists and disables while busy", async () => {
    const bridge = createBridge();
    render(<PlayControls bridge={bridge} />);
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
    expect(bridge.listenPanel.playlistNext).toHaveBeenCalled();
    act(() => {
      useAppStore.setState({ playlistLoadBusy: true });
    });
    expect(next.disabled).toBe(true);
  });
});

describe("VizTop", () => {
  beforeEach(() => {
    localStorage.removeItem("fj-canonizer-finish");
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
    render(<VizTop bridge={createBridge()} />);
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
    const bridge = createBridge();
    render(<VizTop bridge={bridge} />);
    const select = document.getElementById("viz-select") as HTMLSelectElement;
    await userEvent.selectOptions(select, "4");
    expect(bridge.listenPanel.setActiveVisualization).toHaveBeenCalledWith(4);
    act(() => {
      useAppStore.setState({ playMode: "autocanonizer" });
    });
    expect(select.disabled).toBe(true);
  });

  it("switches play mode", async () => {
    const bridge = createBridge();
    render(<VizTop bridge={bridge} />);
    await userEvent.selectOptions(
      document.getElementById("play-mode-select")!,
      "autocanonizer",
    );
    expect(bridge.listenPanel.setPlayMode).toHaveBeenCalledWith("autocanonizer");
  });

  it("persists the canonizer finish checkbox via the bridge", async () => {
    const bridge = createBridge();
    render(<VizTop bridge={bridge} />);
    const checkbox = document.getElementById(
      "canonizer-finish",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await userEvent.click(checkbox);
    expect(bridge.listenPanel.setCanonizerFinish).toHaveBeenCalledWith(true);
    expect(checkbox.checked).toBe(true);
  });
});
