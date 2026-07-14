import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import {
  blurMouseActivatedControl,
  isEditableTarget,
  setAnalysisStatus,
  setLoadingProgress,
  showToast,
} from "./ui";
import { useAppStore } from "./store";
import { setWindowUrl } from "./__tests__/test-utils";


function createContext(): AppContext {
  return {
    engine: {} as unknown as AppContext["engine"],
    player: {} as unknown as AppContext["player"],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    cowbellOverlay: {} as unknown as AppContext["cowbellOverlay"],
    defaultConfig: {} as unknown as AppContext["defaultConfig"],
  };
}

class MockElement {
  tagName: string;
  isContentEditable: boolean;

  constructor(tagName: string, isContentEditable = false) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
  }
  blur = vi.fn();
  addEventListener = vi.fn();
  dispatchEvent() {
    return true;
  }
  removeEventListener = vi.fn();
}

describe("ui helpers", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/");
    (globalThis as any).HTMLElement = MockElement;
  });

  it("sets analysis status and spinner", () => {
    const context = createContext();
    setAnalysisStatus(context, () => "Working", true);
    expect(useAppStore.getState().analysisStatusText()).toBe("Working");
    expect(useAppStore.getState().analysisSpinning).toBe(true);
    setAnalysisStatus(context, () => "Done", false);
    expect(useAppStore.getState().analysisSpinning).toBe(false);
    expect(useAppStore.getState().analysisProgressText).toBe("");
  });

  it("sets loading progress message and percentage", () => {
    const context = createContext();
    setLoadingProgress(context, 55.4, () => "Loading");
    expect(useAppStore.getState().analysisProgressText).toBe("55%");
    expect(useAppStore.getState().analysisStatusText()).toBe("Loading");
    setLoadingProgress(context, null, null);
    expect(useAppStore.getState().analysisProgressText).toBe("");
  });

  it("detects editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(new MockElement("DIV"))).toBe(false);
    expect(isEditableTarget(new MockElement("INPUT"))).toBe(true);
    expect(isEditableTarget(new MockElement("SPAN", true))).toBe(true);
  });

  it("blurs mouse-activated controls", () => {
    const target = new MockElement("BUTTON");
    target.blur = vi.fn();
    blurMouseActivatedControl({
      currentTarget: target,
      detail: 1,
    } as unknown as Event);

    expect(target.blur).toHaveBeenCalledOnce();
  });

  it("keeps focus for keyboard-activated controls", () => {
    const target = new MockElement("BUTTON");
    target.blur = vi.fn();
    blurMouseActivatedControl({
      currentTarget: target,
      detail: 0,
    } as unknown as Event);

    expect(target.blur).not.toHaveBeenCalled();
  });

  describe("toasts", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      (globalThis.window as any).setTimeout = setTimeout;
      (globalThis.window as any).clearTimeout = clearTimeout;
      useAppStore.setState({ toasts: [] });
    });

    afterEach(() => {
      vi.runAllTimers();
      vi.useRealTimers();
    });

    it("shows and hides toast", () => {
      showToast("Hi", { icon: "cloud_done" });
      expect(useAppStore.getState().toasts).toEqual([
        expect.objectContaining({
          message: "Hi",
          icon: "cloud_done",
          tone: "default",
          exiting: false,
        }),
      ]);
      vi.advanceTimersByTime(2000);
      expect(useAppStore.getState().toasts[0]?.exiting).toBe(true);
      vi.advanceTimersByTime(200);
      expect(useAppStore.getState().toasts).toEqual([]);
    });

    it("shows error toast style", () => {
      showToast("Nope", { icon: "error", tone: "error" });
      expect(useAppStore.getState().toasts).toEqual([
        expect.objectContaining({
          message: "Nope",
          icon: "error",
          tone: "error",
          exiting: false,
        }),
      ]);
    });

    it("stacks up to three toasts oldest-first", () => {
      showToast("One");
      showToast("Two");
      showToast("Three");
      expect(
        useAppStore.getState().toasts.map((t) => t.message),
      ).toEqual(["One", "Two", "Three"]);
    });

    it("drops the oldest toast when a fourth arrives", () => {
      showToast("One");
      showToast("Two");
      showToast("Three");
      showToast("Four");
      const toasts = useAppStore.getState().toasts;
      expect(toasts.map((t) => t.message)).toEqual([
        "One",
        "Two",
        "Three",
        "Four",
      ]);
      expect(toasts[0]?.exiting).toBe(true);
      vi.advanceTimersByTime(200);
      expect(
        useAppStore.getState().toasts.map((t) => t.message),
      ).toEqual(["Two", "Three", "Four"]);
    });

    it("refreshes the timer for an identical consecutive message", () => {
      showToast("Same");
      vi.advanceTimersByTime(1000);
      showToast("Same");
      expect(useAppStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1900);
      expect(useAppStore.getState().toasts[0]?.exiting).toBe(false);
      vi.advanceTimersByTime(300);
      expect(useAppStore.getState().toasts).toEqual([]);
    });

    it("updates a keyed toast in place instead of stacking", () => {
      showToast("Play velocity: +1", { key: "play-velocity" });
      showToast("Other");
      vi.advanceTimersByTime(1000);
      showToast("Play velocity: +2", { key: "play-velocity" });
      const toasts = useAppStore.getState().toasts;
      expect(toasts.map((t) => t.message)).toEqual([
        "Play velocity: +2",
        "Other",
      ]);
      expect(toasts[0]?.exiting).toBe(false);
      // The update refreshed the keyed toast's timer, so it outlives "Other".
      vi.advanceTimersByTime(1900);
      expect(
        useAppStore.getState().toasts.map((t) => t.message),
      ).toEqual(["Play velocity: +2"]);
      expect(useAppStore.getState().toasts[0]?.exiting).toBe(false);
      vi.advanceTimersByTime(300);
      expect(useAppStore.getState().toasts).toEqual([]);
    });
  });
});
