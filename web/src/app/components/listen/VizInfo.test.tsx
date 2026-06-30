import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useAppStore } from "../../store";
import { StatusPanel } from "./StatusPanel";
import { VizInfo } from "./VizInfo";

describe("VizInfo", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        trackTitle: null,
        trackArtist: null,
        playMode: "jukebox",
        jukeboxAudioMode: "off",
        listenTimeText: "00:00:00",
        beatsPlayedText: "0",
        bringItHomeMode: false,
        trackDurationSec: 225,
        autocanonizerMainSeconds: 0,
        autocanonizerOtherSeconds: 0,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the default title without a track", () => {
    render(<VizInfo />);
    expect(document.getElementById("viz-now-playing")?.textContent).toBe(
      "Forever Jukebox",
    );
  });

  it("derives the title with audio-mode suffix and artist", () => {
    act(() => {
      useAppStore.setState({
        trackTitle: "Song",
        trackArtist: "Artist",
        jukeboxAudioMode: "nightcore",
      });
    });
    render(<VizInfo />);
    expect(document.getElementById("viz-now-playing")?.textContent).toBe(
      "Song (nightcore) — Artist",
    );
  });

  it("renders counters and hides beats in autocanonizer mode", () => {
    act(() => {
      useAppStore.setState({
        listenTimeText: "00:01:30",
        beatsPlayedText: "42",
      });
    });
    render(<VizInfo />);
    expect(document.getElementById("listen-time")?.textContent).toBe(
      "00:01:30",
    );
    expect(document.getElementById("beats-played")?.textContent).toBe("42");
    expect(document.getElementById("viz-beats-label")?.textContent).toBe(
      "Total Beats:",
    );
    expect(
      document.getElementById("viz-beats-label")?.classList.contains(
        "is-hidden",
      ),
    ).toBe(false);
    act(() => {
      useAppStore.setState({ playMode: "autocanonizer" });
    });
    expect(
      document.getElementById("viz-beats-label")?.classList.contains(
        "is-hidden",
      ),
    ).toBe(true);
    expect(
      document.getElementById("viz-beats-divider")?.classList.contains(
        "is-hidden",
      ),
    ).toBe(true);
    expect(
      document
        .getElementById("autocanonizer-times")
        ?.classList.contains("is-hidden"),
    ).toBe(false);
    expect(
      document.getElementById("autocanonizer-total-time")?.textContent,
    ).toBe("3:45");
  });

  it("renames the beats counter in cowbell mode", () => {
    act(() => {
      useAppStore.setState({ jukeboxAudioMode: "cowbell" });
    });
    render(<VizInfo />);
    expect(document.getElementById("viz-beats-label")?.textContent).toBe(
      "Total Cowbells:",
    );
  });

  it("updates the live counters via direct DOM writes without re-rendering", () => {
    let renders = 0;
    render(
      <Profiler id="viz-info" onRender={() => (renders += 1)}>
        <VizInfo />
      </Profiler>,
    );
    const afterMount = renders;

    act(() => {
      useAppStore.setState({
        listenTimeText: "00:00:05",
        beatsPlayedText: "7",
        autocanonizerMainSeconds: 62,
        autocanonizerOtherSeconds: 125,
      });
    });

    // The DOM reflects the new values...
    expect(document.getElementById("listen-time")?.textContent).toBe(
      "00:00:05",
    );
    expect(document.getElementById("beats-played")?.textContent).toBe("7");
    expect(
      document.getElementById("autocanonizer-main-time")?.textContent,
    ).toBe("1:02");
    expect(
      document.getElementById("autocanonizer-other-time")?.textContent,
    ).toBe("2:05");
    // ...but the high-frequency updates never went through React.
    expect(renders).toBe(afterMount);
  });

  it("still re-renders when track metadata changes", () => {
    let renders = 0;
    render(
      <Profiler id="viz-info" onRender={() => (renders += 1)}>
        <VizInfo />
      </Profiler>,
    );
    const afterMount = renders;
    act(() => {
      useAppStore.setState({ trackTitle: "New Song" });
    });
    expect(renders).toBeGreaterThan(afterMount);
  });

  it("shows the bring-it-home fullscreen note", () => {
    render(<VizInfo />);
    const label = document.getElementById("bring-home-fullscreen-label");
    expect(label?.classList.contains("is-hidden")).toBe(true);
    act(() => {
      useAppStore.setState({ bringItHomeMode: true });
    });
    expect(label?.classList.contains("is-hidden")).toBe(false);
  });
});

describe("StatusPanel", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        analysisStatusText: "No track selected.",
        analysisSpinning: false,
        analysisProgressText: "",
        audioLoaded: false,
        analysisLoaded: false,
        audioLoadInFlight: false,
        swingPreparing: false,
        lastTrackId: null,
        lastJobId: null,
        playlist: { tracks: [], currentIndex: -1 },
        playlistModalOpen: false,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders status text, spinner and progress from the store", () => {
    render(<StatusPanel />);
    expect(document.getElementById("analysis-status")?.textContent).toBe(
      "No track selected.",
    );
    expect(
      document.getElementById("analysis-spinner")?.classList.contains("hidden"),
    ).toBe(true);
    act(() => {
      useAppStore.setState({
        analysisStatusText: "Loading",
        analysisSpinning: true,
        analysisProgressText: "55%",
      });
    });
    expect(document.getElementById("analysis-status")?.textContent).toBe(
      "Loading",
    );
    expect(
      document.getElementById("analysis-spinner")?.classList.contains("hidden"),
    ).toBe(false);
    expect(document.getElementById("analysis-progress")?.textContent).toBe(
      "55%",
    );
  });

  it("hides the container once the track is loaded", () => {
    render(<StatusPanel />);
    const container = document.getElementById("play-status")!;
    expect(container.classList.contains("hidden")).toBe(false);
    act(() => {
      useAppStore.setState({ audioLoaded: true, analysisLoaded: true });
    });
    expect(container.classList.contains("hidden")).toBe(true);
    act(() => {
      useAppStore.setState({ swingPreparing: true });
    });
    expect(container.classList.contains("hidden")).toBe(false);
  });

  it("shows the saved-playlist shortcut for inactive saved playlists", () => {
    render(<StatusPanel />);
    const button = document.getElementById("saved-playlist")!;
    expect(button.classList.contains("hidden")).toBe(true);
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
          currentIndex: -1,
        },
      });
    });
    expect(button.classList.contains("hidden")).toBe(false);
    button.click();
    expect(useAppStore.getState().playlistModalOpen).toBe(true);
  });
});
