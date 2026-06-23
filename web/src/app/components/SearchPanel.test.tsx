import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_SEARCH_HINT,
  DEFAULT_SEARCH_RESULTS,
  useAppStore,
} from "../store";
import { SearchPanel } from "./SearchPanel";

const h = vi.hoisted(() => ({
  submitSearch: vi.fn(async () => {}),
  selectSpotify: vi.fn(),
  selectYoutube: vi.fn(),
  uploadFile: vi.fn(async () => {}),
  uploadUrl: vi.fn(async () => {}),
}));

vi.mock("../search", () => ({
  submitSearch: h.submitSearch,
  selectSpotify: h.selectSpotify,
  selectYoutube: h.selectYoutube,
}));
vi.mock("../upload", () => ({
  uploadFile: h.uploadFile,
  uploadUrl: h.uploadUrl,
}));

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
    render(<SearchPanel />);
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
    render(<SearchPanel />);
    const input = document.getElementById("search-input") as HTMLInputElement;
    await userEvent.type(input, "daft punk{Enter}");
    expect(useAppStore.getState().searchQuery).toBe("daft punk");
    expect(h.submitSearch).toHaveBeenCalledTimes(1);
    await userEvent.click(document.getElementById("search-button")!);
    expect(h.submitSearch).toHaveBeenCalledTimes(2);
  });

  it("renders spotify results and forwards selection", async () => {
    act(() => {
      useAppStore.setState({
        searchResults: {
          kind: "spotify",
          items: [{ name: "Song", artist: "Artist", duration: 200 }],
        },
      });
    });
    render(<SearchPanel />);
    expect(screen.getByText("3:20")).toBeTruthy();
    await userEvent.click(screen.getByText("Song — Artist"));
    expect(h.selectSpotify).toHaveBeenCalledWith({
      name: "Song",
      artist: "Artist",
      duration: 200,
    });
  });

  it("selects results via keyboard (Enter on the focused item)", async () => {
    act(() => {
      useAppStore.setState({
        searchResults: {
          kind: "spotify",
          items: [{ name: "Song", artist: "Artist", duration: 200 }],
        },
      });
    });
    render(<SearchPanel />);
    const select = document.querySelector(".search-item") as HTMLButtonElement;
    expect(select.tagName).toBe("BUTTON");
    select.focus();
    await userEvent.keyboard("{Enter}");
    expect(h.selectSpotify).toHaveBeenCalledWith({
      name: "Song",
      artist: "Artist",
      duration: 200,
    });
  });

  it("Enter on a result's YouTube preview button does not select it", async () => {
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
    render(<SearchPanel />);
    const previewButton = document.querySelector(
      ".search-open",
    ) as HTMLButtonElement;
    previewButton.focus();
    await userEvent.keyboard("{Enter}");
    expect(h.selectYoutube).not.toHaveBeenCalled();
    expect(document.getElementById("youtube-preview-modal")?.className).toBe(
      "modal open",
    );
    const select = document.querySelector(".search-select") as HTMLButtonElement;
    select.focus();
    await userEvent.keyboard("{Enter}");
    expect(h.selectYoutube).toHaveBeenCalledTimes(1);
  });

  it("renders youtube results with preview buttons that do not select", async () => {
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
    render(<SearchPanel />);
    const previewButton = document.querySelector(
      ".search-open",
    ) as HTMLButtonElement;
    expect(previewButton.type).toBe("button");
    expect(previewButton.getAttribute("aria-label")).toBe("Preview on YouTube");
    expect(screen.getByText("2:03")).toBeTruthy();
    // no playlist add controls in search results
    expect(document.querySelectorAll(".playlist-add-button")).toHaveLength(0);
    await userEvent.click(previewButton);
    expect(h.selectYoutube).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Match"));
    expect(h.selectYoutube).toHaveBeenCalledWith({
      youtubeId: "yt-match",
      name: "Song",
      artist: "Artist",
      duration: 123,
    });
  });

  it("loads the youtube thumbnail only after opening the preview modal", async () => {
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
    render(<SearchPanel />);
    const previewButton = document.querySelector(
      ".search-open",
    ) as HTMLButtonElement;

    expect(document.querySelector(".youtube-preview-thumbnail img")).toBeNull();
    await userEvent.click(previewButton);

    const thumbnail = document.querySelector(
      ".youtube-preview-thumbnail img",
    ) as HTMLImageElement;
    expect(thumbnail.src).toBe(
      "https://i.ytimg.com/vi/yt-match/hqdefault.jpg",
    );
    expect(thumbnail.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(thumbnail.alt).toBe("YouTube thumbnail for Match");

    expect(screen.getByRole("heading", { name: "YouTube Preview" })).toBeTruthy();
    const openLink = screen.getByRole("link", { name: "Open in YouTube" });
    expect(openLink.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=yt-match",
    );
    expect(openLink.getAttribute("target")).toBe("_blank");
    expect(openLink.getAttribute("rel")).toBe("noreferrer");

    await userEvent.click(openLink);
    expect(document.getElementById("youtube-preview-modal")?.className).toBe(
      "modal open",
    );

    await userEvent.click(document.getElementById("youtube-preview-close")!);
    expect(document.getElementById("youtube-preview-modal")?.className).toBe(
      "modal",
    );
    expect(document.querySelector(".youtube-preview-thumbnail img")).toBeNull();
    expect(document.activeElement).toBe(previewButton);
  });

  it("hides a failed youtube thumbnail and resets the failure on reopen", async () => {
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
    render(<SearchPanel />);
    const previewButton = document.querySelector(
      ".search-open",
    ) as HTMLButtonElement;

    await userEvent.click(previewButton);
    const thumbnail = document.querySelector(
      ".youtube-preview-thumbnail img",
    ) as HTMLImageElement;
    expect(thumbnail).not.toBeNull();

    fireEvent.error(thumbnail);
    expect(document.querySelector(".youtube-preview-thumbnail img")).toBeNull();
    expect(screen.getByText("Thumbnail unavailable.")).toBeTruthy();

    await userEvent.keyboard("{Escape}");
    expect(document.getElementById("youtube-preview-modal")?.className).toBe(
      "modal",
    );
    await userEvent.click(previewButton);
    expect(
      document.querySelector(".youtube-preview-thumbnail img"),
    ).not.toBeNull();
  });

  it("shows upload sections per app config and submits a URL", async () => {
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
    render(<SearchPanel />);
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
    expect(h.uploadUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc123def45",
      expect.any(Function),
    );
  });
});
