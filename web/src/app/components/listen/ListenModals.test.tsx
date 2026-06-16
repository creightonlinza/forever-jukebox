import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppBridge } from "../../bridge";
import {
  setSleepTimer,
  type ExtrasFormValues,
  type TuningFormValues,
} from "../../playback";
import { useAppStore } from "../../store";
import { InfoModal } from "./InfoModal";
import { PlaylistModal } from "./PlaylistModal";
import { SleepTimerModal } from "./SleepTimerModal";
import { TuningModal } from "./TuningModal";

vi.mock("../../playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../playback")>();
  return { ...actual, setSleepTimer: vi.fn() };
});

const TUNING_FORM: TuningFormValues = {
  threshold: 45,
  computedThreshold: 45,
  minProbPct: 18,
  maxProbPct: 50,
  rampPct: 10,
  justBackwards: false,
  justLongBranches: false,
  removeSequentialBranches: false,
  highlightAnchorBranch: false,
};

const EXTRAS_FORM: ExtrasFormValues = {
  bringItHomeMode: false,
  branchStatsEnabled: false,
  audioMode: "off",
};

function createBridge() {
  return {
    context: {},
    listenPanel: {
      copyShortUrl: vi.fn(),
      toggleFavorite: vi.fn(),
      getPendingDelete: vi.fn(),
      performDelete: vi.fn(async () => {}),
      getTuningForm: vi.fn(() => ({ ...TUNING_FORM })),
      applyTuning: vi.fn((form: TuningFormValues) => ({
        ...form,
        computedThreshold: 47,
      })),
      resetTuning: vi.fn(),
      getExtrasForm: vi.fn(() => ({ ...EXTRAS_FORM })),
      applyExtras: vi.fn(() => ({
        branchStatsChanged: false,
        audioModeChanged: true,
      })),
      resetExtras: vi.fn(() => ({
        branchStatsChanged: false,
        audioModeChanged: false,
      })),
      playlist: {
        selectIndex: vi.fn(),
        removeIndex: vi.fn(),
        clear: vi.fn(),
      },
    },
  } as unknown as AppBridge;
}

beforeEach(() => {
  act(() => {
    useAppStore.setState({
      tuningModalOpen: false,
      tuningModalTab: "tuning",
      infoModalOpen: false,
      sleepTimerModalOpen: false,
      playlistModalOpen: false,
      playMode: "jukebox",
      sleepTimer: { configuredDurationMs: null, endTimeMs: null, remainingMs: 0 },
      trackInfo: {
        durationText: "00:03:21",
        totalBeats: 321,
        branchCount: 42,
        deletedCount: 3,
      },
    });
  });
});

afterEach(() => {
  cleanup();
});

describe("TuningModal", () => {
  it("snapshots the form on open and applies it", async () => {
    const bridge = createBridge();
    render(<TuningModal bridge={bridge} />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    expect(bridge.listenPanel.getTuningForm).toHaveBeenCalled();
    expect(document.getElementById("tuning-modal")?.className).toBe(
      "modal open",
    );
    expect(document.getElementById("threshold-val")?.textContent).toBe("45");
    expect(document.getElementById("computed-threshold")?.textContent).toBe(
      "45",
    );

    await userEvent.click(document.getElementById("tuning-apply")!);
    expect(bridge.listenPanel.applyTuning).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 45, minProbPct: 18 }),
    );
    // apply returns updated values which re-render the form
    expect(document.getElementById("computed-threshold")?.textContent).toBe(
      "47",
    );
  });

  it("switches header and panels between tuning and extras", async () => {
    const bridge = createBridge();
    render(<TuningModal bridge={bridge} />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    expect(document.getElementById("tuning-title-text")?.textContent).toBe(
      "Tuning",
    );
    expect(
      document.getElementById("tuning-panel-extras")?.classList.contains(
        "hidden",
      ),
    ).toBe(true);
    await userEvent.click(document.getElementById("tuning-tab-toggle")!);
    expect(document.getElementById("tuning-title-text")?.textContent).toBe(
      "Extras",
    );
    expect(
      document.getElementById("tuning-panel-tuning")?.classList.contains(
        "hidden",
      ),
    ).toBe(true);
    expect(
      document
        .getElementById("tuning-title")
        ?.classList.contains("is-extras-active"),
    ).toBe(true);
  });

  it("hides the extras toggle and forces the tuning tab outside jukebox mode", () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        tuningModalOpen: true,
        tuningModalTab: "extras",
        playMode: "autocanonizer",
      });
    });
    render(<TuningModal bridge={bridge} />);
    expect(
      document.getElementById("tuning-tab-toggle")?.classList.contains("hidden"),
    ).toBe(true);
    expect(document.getElementById("tuning-title-text")?.textContent).toBe(
      "Tuning",
    );
  });

  it("applies extras and closes", async () => {
    const bridge = createBridge();
    render(<TuningModal bridge={bridge} />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    await userEvent.click(screen.getByLabelText("Nightcore"));
    await userEvent.click(document.getElementById("tuning-apply")!);
    expect(bridge.listenPanel.applyExtras).toHaveBeenCalledWith(
      expect.objectContaining({ audioMode: "nightcore" }),
    );
    expect(useAppStore.getState().tuningModalOpen).toBe(false);
  });

  it("resets tuning and closes", async () => {
    const bridge = createBridge();
    render(<TuningModal bridge={bridge} />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    await userEvent.click(document.getElementById("tuning-reset")!);
    expect(bridge.listenPanel.resetTuning).toHaveBeenCalled();
    expect(useAppStore.getState().tuningModalOpen).toBe(false);
  });

  it("opens the sleep timer from the header", async () => {
    const bridge = createBridge();
    render(<TuningModal bridge={bridge} />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    await userEvent.click(document.getElementById("sleep-timer-open")!);
    expect(useAppStore.getState().sleepTimerModalOpen).toBe(true);
  });
});

describe("SleepTimerModal", () => {
  it("shows the countdown and sets a pending duration", async () => {
    (setSleepTimer as Mock).mockClear();
    render(<SleepTimerModal />);
    act(() => {
      useAppStore.setState({
        sleepTimerModalOpen: true,
        sleepTimer: {
          configuredDurationMs: null,
          endTimeMs: null,
          remainingMs: 0,
        },
      });
    });
    expect(document.getElementById("sleep-timer-current")?.textContent).toBe(
      "Off",
    );
    await userEvent.selectOptions(
      document.getElementById("sleep-timer-select")!,
      "1800000",
    );
    await userEvent.click(document.getElementById("sleep-timer-set")!);
    expect(setSleepTimer).toHaveBeenCalledWith(1800000);
    expect(useAppStore.getState().sleepTimerModalOpen).toBe(false);
  });

  it("renders the remaining countdown from the store", () => {
    act(() => {
      useAppStore.setState({
        sleepTimerModalOpen: true,
        sleepTimer: {
          configuredDurationMs: 1800000,
          endTimeMs: 100,
          remainingMs: 65_000,
        },
      });
    });
    render(<SleepTimerModal />);
    expect(document.getElementById("sleep-timer-current")?.textContent).toBe(
      "Current countdown: 00:01:05",
    );
    expect(
      (document.getElementById("sleep-timer-select") as HTMLSelectElement)
        .value,
    ).toBe("1800000");
  });
});

describe("InfoModal", () => {
  it("renders track info from the store", () => {
    act(() => {
      useAppStore.setState({ infoModalOpen: true });
    });
    render(<InfoModal />);
    expect(document.getElementById("info-duration")?.textContent).toBe(
      "00:03:21",
    );
    expect(document.getElementById("info-beats")?.textContent).toBe("321");
    expect(document.getElementById("info-branches")?.textContent).toBe("42");
    expect(document.getElementById("info-deleted-branches")?.textContent).toBe(
      "3",
    );
    expect(screen.getByText("Keyboard commands")).toBeTruthy();
  });
});

describe("PlaylistModal", () => {
  const tracks = [
    { id: "a", sourceType: "youtube" as const, title: "Song A", artist: "A", duration: null },
    { id: "b", sourceType: "youtube" as const, title: "Song B", artist: "B", duration: null },
  ];

  it("renders tracks and delegates select/remove/clear", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks, currentIndex: 0 },
      });
    });
    render(<PlaylistModal bridge={bridge} />);
    const items = document.querySelectorAll(".playlist-item");
    expect(items).toHaveLength(2);
    expect(items[0].classList.contains("is-current")).toBe(true);
    const selectButtons =
      document.querySelectorAll<HTMLButtonElement>(".playlist-select");
    expect(selectButtons[0].disabled).toBe(true);
    await userEvent.click(selectButtons[1]);
    expect(bridge.listenPanel.playlist.selectIndex).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByLabelText("Remove Song B"));
    expect(bridge.listenPanel.playlist.removeIndex).toHaveBeenCalledWith(1);
    await userEvent.click(document.getElementById("playlist-clear")!);
    expect(bridge.listenPanel.playlist.clear).toHaveBeenCalled();
  });

  it("shows the empty state and disables clear", () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks: [], currentIndex: -1 },
      });
    });
    render(<PlaylistModal bridge={bridge} />);
    expect(document.getElementById("playlist-list")?.textContent).toBe(
      "No playlist yet.",
    );
    expect(
      (document.getElementById("playlist-clear") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("closes on Escape", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks, currentIndex: 0 },
      });
    });
    render(<PlaylistModal bridge={bridge} />);
    await userEvent.keyboard("{Escape}");
    expect(useAppStore.getState().playlistModalOpen).toBe(false);
  });
});
