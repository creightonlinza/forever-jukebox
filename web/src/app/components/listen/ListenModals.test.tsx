import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  applyExtrasChanges,
  applyTuningChanges,
  getExtrasFormValues,
  getTuningFormValues,
  hasNonDefaultTuning,
  resetTuningDefaults,
  type ExtrasFormValues,
  type TuningFormValues,
} from "../../playback";
import { useAppStore } from "../../store";
import {
  clearPlaylist,
  movePlaylistIndex,
  removePlaylistIndex,
  selectPlaylistIndex,
} from "../../playlist-actions";
import { InfoModal } from "./InfoModal";
import { PlaylistModal } from "./PlaylistModal";
import { TuningModal } from "./TuningModal";

vi.mock("../../playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../playback")>();
  return {
    ...actual,
    getTuningFormValues: vi.fn(),
    hasNonDefaultTuning: vi.fn(),
    applyTuningChanges: vi.fn(),
    getExtrasFormValues: vi.fn(),
    applyExtrasChanges: vi.fn(),
    resetTuningDefaults: vi.fn(),
    resetExtrasDefaults: vi.fn(),
  };
});
vi.mock("../../playlist-actions", () => ({
  selectPlaylistIndex: vi.fn(),
  removePlaylistIndex: vi.fn(),
  movePlaylistIndex: vi.fn(),
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
  minLongBranchPercent: 0,
  removeSequentialBranches: false,
  highlightAnchorBranch: false,
};

const EXTRAS_FORM: ExtrasFormValues = {
  bringItHomeMode: false,
  branchStatsEnabled: false,
  customAnchorEnabled: false,
  audioMode: "off",
  audioIntensity: 100,
};

beforeEach(() => {
  (getTuningFormValues as Mock).mockReturnValue({ ...TUNING_FORM });
  (getExtrasFormValues as Mock).mockReturnValue({ ...EXTRAS_FORM });
  (hasNonDefaultTuning as Mock).mockReturnValue(false);
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
      settingsModalOpen: false,
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
    expect(document.getElementById("min-jump-distance-val")?.textContent).toBe(
      "Any distance",
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

  it("maps minimum jump distance slider checkpoints into the form", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    const slider = document.getElementById(
      "min-jump-distance",
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "3" } });
    expect(document.getElementById("min-jump-distance-val")?.textContent).toBe(
      ">20% of track",
    );
    await userEvent.click(document.getElementById("tuning-apply")!);
    expect(applyTuningChanges).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minLongBranchPercent: 20 }),
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

  it("shows the intensity slider only for modes that support it", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    expect(document.getElementById("audio-intensity")).toBeNull();

    await userEvent.click(screen.getByLabelText("Nightcore"));
    expect(document.getElementById("audio-intensity")).not.toBeNull();

    await userEvent.click(screen.getByLabelText("LoFi"));
    expect(document.getElementById("audio-intensity")).toBeNull();
  });

  it("resets intensity for a new mode and restores it when reselecting the opened mode", async () => {
    (getExtrasFormValues as Mock).mockReturnValue({
      ...EXTRAS_FORM,
      audioMode: "nightcore",
      audioIntensity: 130,
    });
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    expect(document.getElementById("audio-intensity-val")?.textContent).toBe(
      "130%",
    );

    await userEvent.click(screen.getByLabelText("Vaporwave"));
    expect(document.getElementById("audio-intensity-val")?.textContent).toBe(
      "100%",
    );

    await userEvent.click(screen.getByLabelText("Nightcore"));
    expect(document.getElementById("audio-intensity-val")?.textContent).toBe(
      "130%",
    );
  });

  it("applies the adjusted intensity from the slider", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    await userEvent.click(screen.getByLabelText("Nightcore"));
    const slider = document.getElementById(
      "audio-intensity",
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "130" } });
    await userEvent.click(document.getElementById("tuning-apply")!);
    expect(applyExtrasChanges).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ audioMode: "nightcore", audioIntensity: 130 }),
    );
  });

  it("resets tuning and closes", async () => {
    (hasNonDefaultTuning as Mock).mockReturnValue(true);
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    await userEvent.click(document.getElementById("tuning-reset")!);
    expect(resetTuningDefaults).toHaveBeenCalled();
    expect(useAppStore.getState().tuningModalOpen).toBe(false);
  });

  it("hides reset on both tabs when nothing differs from defaults", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    expect(document.getElementById("tuning-reset")).toBeNull();
    await userEvent.click(document.getElementById("tuning-tab-toggle")!);
    expect(document.getElementById("tuning-reset")).toBeNull();
  });

  it("shows tuning reset while the form differs from what was applied", () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    const slider = document.getElementById("threshold") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "60" } });
    expect(document.getElementById("tuning-reset")).not.toBeNull();
    fireEvent.change(slider, { target: { value: "45" } });
    expect(document.getElementById("tuning-reset")).toBeNull();
  });

  it("does not show tuning reset for the sticky anchor highlight", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    await userEvent.click(document.getElementById("highlight-anchor-branch")!);
    expect(document.getElementById("tuning-reset")).toBeNull();
  });

  it("shows extras reset for applied or selected extras but not branch stats", async () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    await userEvent.click(document.getElementById("extras-enabled")!);
    expect(document.getElementById("tuning-reset")).toBeNull();
    await userEvent.click(document.getElementById("bring-home-enabled")!);
    expect(document.getElementById("tuning-reset")).not.toBeNull();
    await userEvent.click(document.getElementById("bring-home-enabled")!);
    await userEvent.click(screen.getByLabelText("Daycore"));
    expect(document.getElementById("tuning-reset")).not.toBeNull();
  });

  it("shows extras reset when an audio mode is already applied", () => {
    (getExtrasFormValues as Mock).mockReturnValue({
      ...EXTRAS_FORM,
      audioMode: "daycore",
    });
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true, tuningModalTab: "extras" });
    });
    expect(document.getElementById("tuning-reset")).not.toBeNull();
  });

  it("does not expose sleep timer controls", () => {
    render(<TuningModal />);
    act(() => {
      useAppStore.setState({ tuningModalOpen: true });
    });
    expect(document.getElementById("sleep-timer-open")).toBeNull();
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

  it("moves a track with the arrow keys and keeps focus on its handle", async () => {
    vi.mocked(movePlaylistIndex).mockReset();
    vi.mocked(movePlaylistIndex).mockImplementation(() => {
      useAppStore.setState({
        playlist: { tracks: [tracks[1], tracks[0]], currentIndex: 1 },
      });
    });
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks, currentIndex: 0 },
      });
    });
    render(<PlaylistModal />);
    screen.getByLabelText("Reorder Song A").focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(movePlaylistIndex).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}");

    expect(movePlaylistIndex).toHaveBeenCalledWith(0, 1);
    const handles = document.querySelectorAll(".playlist-drag-handle");
    expect(handles[1].getAttribute("aria-label")).toBe("Reorder Song A");
    expect(document.activeElement).toBe(handles[1]);
    vi.mocked(movePlaylistIndex).mockReset();
  });

  it("keeps the artist line for a track without an artist", () => {
    act(() => {
      useAppStore.setState({
        playlistModalOpen: true,
        playlist: { tracks: [tracks[0], { ...tracks[1], artist: "" }], currentIndex: 0 },
      });
    });
    render(<PlaylistModal />);
    const artists = document.querySelectorAll(".playlist-item-artist");
    expect(artists[1].textContent).toBe("\u00a0");
  });

  describe("dragging a handle", () => {
    const rowPitch = 50;

    // jsdom has no PointerEvent, so fired pointer events would lack pointerId and isPrimary.
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.isPrimary = init.isPrimary ?? false;
      }
    }

    beforeEach(() => {
      vi.stubGlobal("PointerEvent", TestPointerEvent);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
        function (this: HTMLElement) {
          const parent = this.parentElement;
          return parent ? Array.from(parent.children).indexOf(this) * rowPitch : 0;
        },
      );
      HTMLElement.prototype.setPointerCapture = vi.fn();
      vi.mocked(movePlaylistIndex).mockClear();
      act(() => {
        useAppStore.setState({
          playlistModalOpen: true,
          playlist: { tracks, currentIndex: 0 },
        });
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    });

    function dragHandle(label: string, deltaY: number) {
      const handle = screen.getByLabelText(label);
      fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientY: 100 });
      fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: 100 + deltaY });
      return handle;
    }

    it("moves the track to the slot it is dropped on", () => {
      render(<PlaylistModal />);
      const handle = dragHandle("Reorder Song A", rowPitch);
      expect(document.querySelector(".playlist-item.is-dragging")).not.toBeNull();
      fireEvent.pointerUp(handle, { pointerId: 1, isPrimary: true, clientY: 150 });

      expect(movePlaylistIndex).toHaveBeenCalledWith(0, 1);
      expect(document.querySelector(".playlist-item.is-dragging")).toBeNull();
    });

    it("snaps back without moving when the drag is cancelled", () => {
      render(<PlaylistModal />);
      const handle = dragHandle("Reorder Song B", -rowPitch);
      fireEvent.pointerCancel(handle, { pointerId: 1, isPrimary: true });

      expect(movePlaylistIndex).not.toHaveBeenCalled();
      expect(document.querySelector(".playlist-item.is-dragging")).toBeNull();
    });

    it("scrolls the list while the pointer rests near its bottom edge", () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      render(<PlaylistModal />);
      const wrap = document.getElementById("playlist-list")!;
      let scrollTop = 0;
      Object.defineProperty(wrap, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      });
      vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue(
        { top: 0, bottom: 150 } as DOMRect,
      );
      // 130 sits 20px into the 40px bottom edge, so each frame scrolls 5px.
      dragHandle("Reorder Song A", 30);
      const row = () => document.querySelector<HTMLElement>(".playlist-item.is-dragging")!;
      expect(row().style.transform).toBe("translateY(30px)");
      act(() => {
        frames[frames.length - 1](0);
      });

      expect(scrollTop).toBe(5);
      expect(row().style.transform).toBe("translateY(35px)");
    });

    it("drops nothing when the modal closes mid-drag", () => {
      render(<PlaylistModal />);
      const handle = dragHandle("Reorder Song A", rowPitch);
      act(() => {
        useAppStore.setState({ playlistModalOpen: false });
      });
      fireEvent.pointerUp(handle, { pointerId: 1, isPrimary: true, clientY: 150 });

      expect(movePlaylistIndex).not.toHaveBeenCalled();
    });
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
