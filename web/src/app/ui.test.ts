import { beforeEach, describe, expect, it, vi } from "vitest";
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

function createClassList() {
  return {
    add: vi.fn(),
    remove: vi.fn(),
  };
}

function createContext(): AppContext {
  return {
    elements: {
      analysisStatus: { textContent: "" },
      analysisSpinner: { classList: createClassList() },
      analysisProgress: { textContent: "" },
      canonizerFinish: { checked: false, addEventListener: vi.fn() },
    } as unknown as AppContext["elements"],
    engine: {} as unknown as AppContext["engine"],
    player: {} as unknown as AppContext["player"],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    cowbellOverlay: {} as unknown as AppContext["cowbellOverlay"],
    defaultConfig: {} as unknown as AppContext["defaultConfig"],
    state: {
      toastTimer: null,
      playMode: "jukebox",
    } as unknown as AppContext["state"],
  };
}

class MockElement {
  constructor(
    public tagName: string,
    public isContentEditable = false,
  ) {}
  blur() {}
  addEventListener() {}
  dispatchEvent() {
    return true;
  }
  removeEventListener() {}
}

describe("ui helpers", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/");
    (globalThis as any).HTMLElement = MockElement;
  });

  it("sets analysis status and spinner", () => {
    const context = createContext();
    setAnalysisStatus(context, "Working", true);
    expect(useAppStore.getState().analysisStatusText).toBe("Working");
    expect(useAppStore.getState().analysisSpinning).toBe(true);
    setAnalysisStatus(context, "Done", false);
    expect(useAppStore.getState().analysisSpinning).toBe(false);
    expect(useAppStore.getState().analysisProgressText).toBe("");
  });

  it("sets loading progress message and percentage", () => {
    const context = createContext();
    setLoadingProgress(context, 55.4, "Loading");
    expect(useAppStore.getState().analysisProgressText).toBe("55%");
    expect(useAppStore.getState().analysisStatusText).toBe("Loading");
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

  it("shows and hides toast", () => {
    vi.useFakeTimers();
    const context = createContext();
    (globalThis.window as any).setTimeout = setTimeout;
    (globalThis.window as any).clearTimeout = clearTimeout;
    showToast(context, "Hi", { icon: "check" });
    expect(useAppStore.getState().toast).toEqual({
      message: "Hi",
      icon: "check",
      tone: "default",
    });
    vi.runAllTimers();
    expect(useAppStore.getState().toast).toBeNull();
    vi.useRealTimers();
  });

  it("shows error toast style", () => {
    const context = createContext();
    showToast(context, "Nope", { icon: "error", tone: "error" });
    expect(useAppStore.getState().toast).toEqual({
      message: "Nope",
      icon: "error",
      tone: "error",
    });
  });
});
