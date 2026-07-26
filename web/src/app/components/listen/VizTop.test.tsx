import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../../store";
import { VizTop } from "./VizTop";

const h = vi.hoisted(() => ({
  setActiveVisualization: vi.fn(),
  setCanonizerFinish: vi.fn(),
  setPlayMode: vi.fn(),
  trackEvent: vi.fn(),
  getCount: vi.fn(() => 6),
}));

vi.mock("../../playback-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback-ui")>()),
  setActiveVisualization: h.setActiveVisualization,
  setCanonizerFinish: h.setCanonizerFinish,
  setPlayMode: h.setPlayMode,
}));
vi.mock("../../analytics", () => ({
  trackEvent: h.trackEvent,
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => ({ jukebox: { getCount: h.getCount } })),
}));

describe("VizTop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getCount.mockReturnValue(6);
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

  it("reports the visualization label, not the index, on switch", async () => {
    render(<VizTop />);
    await userEvent.selectOptions(document.getElementById("viz-select")!, "2");

    expect(h.trackEvent).toHaveBeenCalledWith("select_viz", { viz: "Galaxy" });
    expect(h.setActiveVisualization).toHaveBeenCalledWith(2);
  });

  it("falls back to the index for visualizations beyond the label list", async () => {
    h.getCount.mockReturnValue(8);
    render(<VizTop />);
    await userEvent.selectOptions(document.getElementById("viz-select")!, "6");

    expect(h.trackEvent).toHaveBeenCalledWith("select_viz", { viz: "6" });
  });

  it("does not report while the selector is disabled", async () => {
    act(() => {
      useAppStore.setState({ audioLoaded: false });
    });
    render(<VizTop />);
    const select = document.getElementById("viz-select") as HTMLSelectElement;

    expect(select.disabled).toBe(true);
    expect(h.trackEvent).not.toHaveBeenCalled();
  });
});
