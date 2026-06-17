import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { useAppStore } from "../../store";
import { VizContainer } from "./VizContainer";

const h = vi.hoisted(() => ({
  attachViz: vi.fn(),
  jukebox: {
    getCount: vi.fn(() => 6),
    resizeNow: vi.fn(),
    resizeActive: vi.fn(),
  },
  autocanonizer: { resizeNow: vi.fn() },
}));

vi.mock("../../runtime", () => ({
  attachViz: h.attachViz,
  getAppContext: vi.fn(() => ({
    jukebox: h.jukebox,
    autocanonizer: h.autocanonizer,
  })),
}));

class StubResizeObserver {
  static instances: StubResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    StubResizeObserver.instances.push(this);
  }
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("VizContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useAppStore.setState({
        audioLoaded: false,
        analysisLoaded: false,
        swingPreparing: false,
        playMode: "jukebox",
        branchStats: null,
        playlist: { tracks: [], currentIndex: -1 },
        volumePct: 50,
        isFullscreen: false,
      });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the panel and layer nodes to attachViz under StrictMode", () => {
    render(
      <StrictMode>
        <VizContainer />
      </StrictMode>,
    );
    expect(h.attachViz).toHaveBeenCalled();
    const nodes = h.attachViz.mock.calls[0][0];
    expect(nodes.vizPanel.id).toBe("viz-panel");
    expect(nodes.vizLayer.id).toBe("viz-layer");
    expect(nodes.canonizerLayer.id).toBe("canonizer-layer");
    // every (re-)attach passes the SAME nodes — the layers never remount
    for (const call of h.attachViz.mock.calls) {
      expect(call[0].vizLayer).toBe(nodes.vizLayer);
      expect(call[0].canonizerLayer).toBe(nodes.canonizerLayer);
    }
  });

  it("keeps the layer nodes identical across state-driven re-renders", () => {
    render(<VizContainer />);
    const layer = document.getElementById("viz-layer");
    const canonizer = document.getElementById("canonizer-layer");
    act(() => {
      useAppStore.setState({
        audioLoaded: true,
        analysisLoaded: true,
        playMode: "autocanonizer",
      });
    });
    expect(document.getElementById("viz-layer")).toBe(layer);
    expect(document.getElementById("canonizer-layer")).toBe(canonizer);
    expect(
      document.getElementById("jukebox-viz")?.classList.contains("is-canonizer"),
    ).toBe(true);
    expect(
      document.getElementById("viz-panel")?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("hides the panel until loaded and resizes on reveal", () => {
    render(<VizContainer />);
    expect(
      document.getElementById("viz-panel")?.classList.contains("hidden"),
    ).toBe(true);
    act(() => {
      useAppStore.setState({ audioLoaded: true, analysisLoaded: true });
    });
    expect(
      document.getElementById("viz-panel")?.classList.contains("hidden"),
    ).toBe(false);
    expect(h.jukebox.resizeActive).toHaveBeenCalled();
  });

  it("observes the panel with ResizeObserver and resizes both controllers", () => {
    StubResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    const { unmount } = render(<VizContainer />);

    // An effect remount (StrictMode-style) can create then disconnect an
    // earlier observer; the last one is the live subscription.
    expect(StubResizeObserver.instances.length).toBeGreaterThanOrEqual(1);
    const observer =
      StubResizeObserver.instances[StubResizeObserver.instances.length - 1];
    expect(observer.observe).toHaveBeenCalledWith(
      document.getElementById("viz-panel"),
    );

    act(() => observer.trigger());
    expect(h.jukebox.resizeNow).toHaveBeenCalled();
    expect(h.autocanonizer.resizeNow).toHaveBeenCalled();

    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("falls back to the window resize listener without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<VizContainer />);

    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(h.jukebox.resizeNow).toHaveBeenCalled();
    expect(h.autocanonizer.resizeNow).toHaveBeenCalled();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
