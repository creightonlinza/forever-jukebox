import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppBridge } from "../bridge";
import {
  DEFAULT_SEARCH_HINT,
  DEFAULT_SEARCH_RESULTS,
  useAppStore,
} from "../store";
import { SearchPanel } from "./SearchPanel";

function createBridge() {
  return {
    searchPanel: {
      runSearch: vi.fn(async () => {}),
      selectSpotify: vi.fn(),
      selectYoutube: vi.fn(),
      uploadFile: vi.fn(async () => {}),
      uploadUrl: vi.fn(async () => {}),
    },
  } as unknown as AppBridge;
}

describe("SearchPanel", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        activeTabId: "search",
        searchTab: "search",
        searchQuery: "",
        searchHint: DEFAULT_SEARCH_HINT,
        searchResults: DEFAULT_SEARCH_RESULTS,
        appConfig: null,
      });
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the default hint and results message", () => {
    render(<SearchPanel bridge={createBridge()} />);
    expect(document.getElementById("search-hint")?.textContent).toBe(
      "Step 1: Find a Spotify track.",
    );
    expect(document.getElementById("search-results")?.textContent).toBe(
      "Search results will appear here.",
    );
    // upload subtabs hidden without config
    expect(
      document.getElementById("search-subtabs")?.classList.contains("hidden"),
    ).toBe(true);
  });

  it("runs a search on Enter and button click", async () => {
    const bridge = createBridge();
    render(<SearchPanel bridge={bridge} />);
    const input = document.getElementById("search-input") as HTMLInputElement;
    await userEvent.type(input, "daft punk{Enter}");
    expect(useAppStore.getState().searchQuery).toBe("daft punk");
    expect(bridge.searchPanel.runSearch).toHaveBeenCalledTimes(1);
    await userEvent.click(document.getElementById("search-button")!);
    expect(bridge.searchPanel.runSearch).toHaveBeenCalledTimes(2);
  });

  it("renders spotify results and forwards selection", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        searchResults: {
          kind: "spotify",
          items: [{ name: "Song", artist: "Artist", duration: 200 }],
        },
      });
    });
    render(<SearchPanel bridge={bridge} />);
    await userEvent.click(screen.getByText("Song — Artist"));
    expect(bridge.searchPanel.selectSpotify).toHaveBeenCalledWith({
      name: "Song",
      artist: "Artist",
      duration: 200,
    });
  });

  it("renders youtube results with open links that do not select", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        searchResults: {
          kind: "youtube",
          items: [
            {
              item: { id: "yt-match", title: "Match", duration: 123 },
              name: "Song",
              artist: "Artist",
            },
          ],
        },
      });
    });
    render(<SearchPanel bridge={bridge} />);
    const openLink = document.querySelector(".search-open") as HTMLAnchorElement;
    expect(openLink.href).toBe("https://www.youtube.com/watch?v=yt-match");
    // no playlist add controls in search results
    expect(document.querySelectorAll(".playlist-add-button")).toHaveLength(0);
    await userEvent.click(openLink);
    expect(bridge.searchPanel.selectYoutube).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Match"));
    expect(bridge.searchPanel.selectYoutube).toHaveBeenCalledWith({
      youtubeId: "yt-match",
      name: "Song",
      artist: "Artist",
      duration: 123,
    });
  });

  it("shows upload sections per app config and submits a URL", async () => {
    const bridge = createBridge();
    act(() => {
      useAppStore.setState({
        appConfig: {
          allow_user_upload: true,
          allow_user_url: true,
          max_upload_size: 10 * 1024 * 1024,
          allowed_upload_exts: [".mp3", ".wav"],
        } as never,
        searchTab: "upload",
      });
    });
    render(<SearchPanel bridge={bridge} />);
    expect(
      document.getElementById("search-subtabs")?.classList.contains("hidden"),
    ).toBe(false);
    expect(document.getElementById("search-panel-title")?.textContent).toBe(
      "Upload",
    );
    expect(document.getElementById("upload-file-hint")?.textContent).toBe(
      "Max file size: 10 MB. Allowed: .mp3, .wav",
    );
    const urlInput = document.getElementById(
      "upload-youtube-input",
    ) as HTMLInputElement;
    await userEvent.type(urlInput, "https://www.youtube.com/watch?v=abc123def45");
    await userEvent.click(document.getElementById("upload-youtube-button")!);
    expect(bridge.searchPanel.uploadUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc123def45",
      expect.any(Function),
    );
  });
});
