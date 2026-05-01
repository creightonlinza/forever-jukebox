import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import {
  isEditableTarget,
  setAnalysisStatus,
  setLoadingProgress,
  showToast,
} from "./ui";
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
      toast: {
        classList: createClassList(),
        innerHTML: "",
        textContent: "",
      },
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
    expect(context.elements.analysisStatus.textContent).toBe("Working");
    expect(
      context.elements.analysisSpinner.classList.remove,
    ).toHaveBeenCalledWith("hidden");
    setAnalysisStatus(context, "Done", false);
    expect(
      context.elements.analysisSpinner.classList.add,
    ).toHaveBeenCalledWith("hidden");
    expect(context.elements.analysisProgress.textContent).toBe("");
  });

  it("sets loading progress message and percentage", () => {
    const context = createContext();
    setLoadingProgress(context, 55.4, "Loading");
    expect(context.elements.analysisProgress.textContent).toBe("55%");
    setLoadingProgress(context, null, null);
    expect(context.elements.analysisProgress.textContent).toBe("");
  });

  it("detects editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(new MockElement("DIV"))).toBe(false);
    expect(isEditableTarget(new MockElement("INPUT"))).toBe(true);
    expect(isEditableTarget(new MockElement("SPAN", true))).toBe(true);
  });

  it("shows and hides toast", () => {
    vi.useFakeTimers();
    const context = createContext();
    (globalThis.window as any).setTimeout = setTimeout;
    (globalThis.window as any).clearTimeout = clearTimeout;
    showToast(context, "Hi", { icon: "check" });
    expect(context.elements.toast.innerHTML).toContain("check");
    expect(context.elements.toast.classList.remove).toHaveBeenCalledWith("error");
    expect(context.elements.toast.classList.remove).toHaveBeenCalledWith(
      "hidden",
    );
    vi.runAllTimers();
    expect(context.elements.toast.classList.add).toHaveBeenCalledWith("hidden");
    vi.useRealTimers();
  });

  it("shows error toast style", () => {
    const context = createContext();
    showToast(context, "Nope", { icon: "error", tone: "error" });
    expect(context.elements.toast.classList.add).toHaveBeenCalledWith("error");
  });
});
