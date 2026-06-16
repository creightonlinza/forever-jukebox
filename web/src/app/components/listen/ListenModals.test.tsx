import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  applyExtrasChanges,
  applyTuningChanges,
  getExtrasFormValues,
  getTuningFormValues,
  resetTuningDefaults,
  setSleepTimer,
  type ExtrasFormValues,
  type TuningFormValues,
} from "../../playback";
import { useAppStore } from "../../store";
import {
  clearPlaylist,
  removePlaylistIndex,
  selectPlaylistIndex,
} from "../../wire/playlist";
import { InfoModal } from "./InfoModal";
import { PlaylistModal } from "./PlaylistModal";
import { SleepTimerModal } from "./SleepTimerModal";
import { TuningModal } from "./TuningModal";

vi.mock("../../playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../playback")>();
  return {
    ...actual,
    setSleepTimer: vi.fn(),
    getTuningFormValues: vi.fn(),
    applyTuningChanges: vi.fn(),
    getExtrasFormValues: vi.fn(),
    applyExtrasChanges: vi.fn(),
    resetTuningDefaults: vi.fn(),
    resetExtrasDefaults: vi.fn(),
  };
});
vi.mock("../../wire/playlist", () => ({
  selectPlaylistIndex: vi.fn(),
  removePlaylistIndex: vi.fn(),
  clearPlaylist: vi.fn(),
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => ({})),
}));

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

beforeEach(() => {
  (getTuningFormValues as Mock).mockReturnValue({ ...TUNING_FORM });
  (getExtrasFormValues as Mock).mockReturnValue({ ...EXTRAS_FORM });
  (applyTuningChanges as Mock).mockImplementation((_ctx, form) => ({
    ...form,
    computedThreshold: 47,
  }));
  (applyExtrasChanges as Mock).mockReturnValue({
    branchStatsChanged: false,
    audioModeChanged: true,
  });
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
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    expect(getTuningFormValues).toHaveBeenCalled();
    expect(document.getElementById("tuning-modal")?.className).toBe(
      "modal open",
    );
    expect(document.getElementById("threshold-val")?.textContent).toBe("45");
    expect(document.getElementById("computed-threshold")?.textContent).toBe(
      "45",
    );

    await userEvent.click(document.getElementById("tuning-apply")!);
    expect(applyTuningChanges).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threshold: 45, minProbPct: 18 }),
    );
    // apply returns updated values which re-render the form
    expect(document.getElementById("computed-threshold")?.textContent).toBe(
      "47",
    );
  });

  it("switches header and panels between tuning and extras", async () => {
    render(<TuningModal />);
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
    act(() => {
      useAppStore.setState({
        tuningModalOpen: true,
        tuningModalTab: "extras",
        playMode: "autocanonizer",
      });
    });
    render(<TuningModal />);
    expect(
      document.getElementById("tuning-tab-toggle")?.classList.contains("hidden"),
    ).toBe(true);
    expect(document.getElementById("tuning-title-text")?.textContent).toBe(
      "Tuning",
    );
  });

  it("applies extras and closes", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    await userEvent.click(screen.getByLabelText("Nightcore"));
    await userEvent.click(document.getElementById("tuning-apply")!);
    expect(applyExtrasChanges).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ audioMode: "nightcore" }),
    );
    expect(useAppStore.getState().tuningModalOpen).toBe(false);
  });

  it("resets tuning and closes", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    await userEvent.click(document.getElementById("tuning-reset")!);
    expect(resetTuningDefaults).toHaveBeenCalled();
    expect(useAppStore.getState().tuningModalOpen).toBe(false);
  });

  it("opens the sleep timer from the header", async () => {
    render(<TuningModal />);
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
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks, currentIndex: 0 },
      });
    });
    render(<PlaylistModal />);
    const items = document.querySelectorAll(".playlist-item");
    expect(items).toHaveLength(2);
    expect(items[0].classList.contains("is-current")).toBe(true);
    const selectButtons =
      document.querySelectorAll<HTMLButtonElement>(".playlist-select");
    expect(selectButtons[0].disabled).toBe(true);
    await userEvent.click(selectButtons[1]);
    expect(selectPlaylistIndex).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByLabelText("Remove Song B"));
    expect(removePlaylistIndex).toHaveBeenCalledWith(1);
    await userEvent.click(document.getElementById("playlist-clear")!);
    expect(clearPlaylist).toHaveBeenCalled();
  });

  it("shows the empty state and disables clear", () => {
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks: [], currentIndex: -1 },
      });
    });
    render(<PlaylistModal />);
    expect(document.getElementById("playlist-list")?.textContent).toBe(
      "No playlist yet.",
    );
    expect(
      (document.getElementById("playlist-clear") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("closes on Escape", async () => {
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks, currentIndex: 0 },
      });
    });
    render(<PlaylistModal />);
    await userEvent.keyboard("{Escape}");
    expect(useAppStore.getState().playlistModalOpen).toBe(false);
  });
});
