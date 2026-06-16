import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../../store";
import { VizBottomRight } from "./VizBottomRight";

const h = vi.hoisted(() => ({
  setMasterVolume: vi.fn(),
  toggleFullscreen: vi.fn(),
}));

vi.mock("../../playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback")>()),
  setMasterVolume: h.setMasterVolume,
}));
vi.mock("../../wire/fullscreen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../wire/fullscreen")>()),
  toggleFullscreen: h.toggleFullscreen,
}));
vi.mock("../../runtime", () => ({
  getAppContext: vi.fn(() => ({})),
}));

describe("VizBottomRight", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        playlist: { tracks: [], currentIndex: -1 },
        volumePct: 50,
        isFullscreen: false,
        playlistModalOpen: false,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("toggles the volume panel and applies volume changes", async () => {
    render(<VizBottomRight />);
    const panel = document.getElementById("volume-control-panel")!;
    expect(panel.classList.contains("is-hidden")).toBe(true);
    await userEvent.click(document.getElementById("volume-button")!);
    expect(panel.classList.contains("is-hidden")).toBe(false);
    const slider = document.getElementById("volume") as HTMLInputElement;
    // range inputs: fire a change directly
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, "80");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(h.setMasterVolume).toHaveBeenCalledWith(expect.anything(), 80);
    expect(document.getElementById("volume-val")?.textContent).toBe("80");
    // click-away closes
    await userEvent.click(document.body);
    expect(panel.classList.contains("is-hidden")).toBe(true);
  });

  it("reflects external volume sync from the store", () => {
    render(<VizBottomRight />);
    act(() => {
      useAppStore.setState({ volumePct: 25 });
    });
    expect(
      (document.getElementById("volume") as HTMLInputElement).value,
    ).toBe("25");
  });

  it("renders the fullscreen state and toggles it", async () => {
    render(<VizBottomRight />);
    const button = document.getElementById("fullscreen")!;
    expect(button.getAttribute("aria-label")).toBe("Fullscreen");
    expect(button.querySelector(".fullscreen-icon")?.textContent).toBe(
      "fullscreen",
    );
    await userEvent.click(button);
    expect(h.toggleFullscreen).toHaveBeenCalled();
    act(() => {
      useAppStore.setState({ isFullscreen: true });
    });
    expect(button.getAttribute("aria-label")).toBe("Exit Fullscreen");
    expect(button.querySelector(".fullscreen-icon")?.textContent).toBe(
      "fullscreen_exit",
    );
  });

  it("shows the playlist button only with tracks and opens the modal", async () => {
    render(<VizBottomRight />);
    const button = document.getElementById("playlist-open")!;
    expect(button.classList.contains("is-hidden")).toBe(true);
    act(() => {
      useAppStore.setState({
        playlist: {
          tracks: [
            {
              id: "a",
              sourceType: "youtube",
              title: "A",
              artist: "",
              duration: null,
            },
            {
              id: "b",
              sourceType: "youtube",
              title: "B",
              artist: "",
              duration: null,
            },
          ],
          currentIndex: 0,
        },
      });
    });
    expect(button.classList.contains("is-hidden")).toBe(false);
    expect(button.getAttribute("title")).toBe("Playlist (1/2)");
    await userEvent.click(button);
    expect(useAppStore.getState().playlistModalOpen).toBe(true);
  });
});
