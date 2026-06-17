// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import { releaseWakeLock, requestWakeLock } from "./playback/wake-lock";
import { attachViz, setAppRuntime } from "./runtime";
import { useAppStore } from "./store";
import {
  handleFullscreenChange,
  handleVisibilityChange,
  toggleFullscreen,
} from "./fullscreen";

vi.mock("./playback/wake-lock", () => ({
  releaseWakeLock: vi.fn(),
  requestWakeLock: vi.fn(),
}));

const initialStoreState = useAppStore.getState();

function setDocumentFullscreenElement(value: Element | null) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value,
  });
}

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value,
  });
}

type TestAppContext = AppContext & {
  jukebox: NonNullable<AppContext["jukebox"]>;
};

function setupRuntime(): TestAppContext {
  const context = {
    autocanonizer: {},
    jukebox: { resizeActive: vi.fn() },
  } as unknown as TestAppContext;
  setAppRuntime(context);
  return context;
}

async function flushMicrotasks(count = 3) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

describe("fullscreen actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(initialStoreState, true);
    setupRuntime();
    setDocumentFullscreenElement(null);
    setDocumentHidden(false);
  });

  it("enters fullscreen through the attached viz panel and requests wake lock", async () => {
    const requestFullscreen = vi.fn(async () => {});
    attachViz({
      vizPanel: { requestFullscreen } as unknown as HTMLElement,
      vizLayer: document.createElement("div"),
      canonizerLayer: document.createElement("div"),
    });

    toggleFullscreen();
    await flushMicrotasks();

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestWakeLock).toHaveBeenCalledOnce();
  });

  it("exits fullscreen and releases wake lock", async () => {
    const fullscreenElement = document.createElement("div");
    const exitFullscreen = vi.fn(async () => {});
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    setDocumentFullscreenElement(fullscreenElement);

    toggleFullscreen();
    await flushMicrotasks();

    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(releaseWakeLock).toHaveBeenCalledOnce();
  });

  it("syncs fullscreen store state, wake lock, and active viz size", () => {
    const context = setupRuntime();
    setDocumentFullscreenElement(document.createElement("div"));

    handleFullscreenChange();

    expect(useAppStore.getState().isFullscreen).toBe(true);
    expect(requestWakeLock).toHaveBeenCalledOnce();
    expect(context.jukebox.resizeActive).toHaveBeenCalledOnce();

    setDocumentFullscreenElement(null);
    handleFullscreenChange();

    expect(useAppStore.getState().isFullscreen).toBe(false);
    expect(releaseWakeLock).toHaveBeenCalledOnce();
    expect(context.jukebox.resizeActive).toHaveBeenCalledTimes(2);
  });

  it("renews wake lock when visible in fullscreen and releases it when hidden", () => {
    setDocumentFullscreenElement(document.createElement("div"));
    setDocumentHidden(false);
    handleVisibilityChange();
    expect(requestWakeLock).toHaveBeenCalledOnce();

    setDocumentHidden(true);
    handleVisibilityChange();
    expect(releaseWakeLock).toHaveBeenCalledOnce();
  });
});
