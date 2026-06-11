import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTopSongsHandlers } from "./top-songs";

type FakeElement = {
  tagName: string;
  className: string;
  textContent: string;
  innerHTML: string;
  href: string;
  title: string;
  disabled: boolean;
  dataset: Record<string, string>;
  children: FakeElement[];
  append: (...children: FakeElement[]) => void;
  appendChild: (child: FakeElement) => FakeElement;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (name: string, listener: EventListener) => void;
};

function createFakeElement(tagName: string): FakeElement {
  return {
    tagName,
    className: "",
    textContent: "",
    innerHTML: "",
    href: "",
    title: "",
    disabled: false,
    dataset: {},
    children: [],
    append(...children: FakeElement[]) {
      this.children.push(...children);
    },
    appendChild(child: FakeElement) {
      this.children.push(child);
      return child;
    },
    setAttribute() {},
    addEventListener() {},
  };
}

function findByTag(element: FakeElement, tagName: string): FakeElement[] {
  const matches = element.tagName === tagName ? [element] : [];
  for (const child of element.children) {
    matches.push(...findByTag(child, tagName));
  }
  return matches;
}

describe("createTopSongsHandlers", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: vi.fn((tagName: string) => createFakeElement(tagName)),
    });
  });

  it("uses job id for YouTube list links and playlist items", async () => {
    const topSongsList = createFakeElement("ol");
    const onAddToPlaylist = vi.fn();
    const handlers = createTopSongsHandlers({
      elements: {
        topSongsList,
        recentSongsList: createFakeElement("ol"),
        trendingSongsList: createFakeElement("ol"),
      } as never,
      fetchTopSongs: vi.fn(async () => [
        {
          id: "a3f3c0dc73c6476c9db95c227f9206f2",
          source_id: "abc123def45",
          source_provider: "youtube",
          title: "Song",
          artist: "Artist",
        },
      ]),
      fetchTrendingSongs: vi.fn(async () => []),
      fetchRecentSongs: vi.fn(async () => []),
      loadTrackById: vi.fn(),
      loadTrackByJobId: vi.fn(),
      navigateToTabWithState: vi.fn(),
      limit: 10,
      onAddToPlaylist,
    });

    await handlers.fetchTopSongsList();

    const link = findByTag(topSongsList, "a")[0];
    expect(link.href).toBe("/listen/a3f3c0dc73c6476c9db95c227f9206f2");
    expect(link.dataset.trackId).toBe("a3f3c0dc73c6476c9db95c227f9206f2");
    expect(link.dataset.playlistId).toBe("a3f3c0dc73c6476c9db95c227f9206f2");
  });
});
