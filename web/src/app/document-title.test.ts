import { describe, expect, it } from "vitest";
import { titleForAppView } from "./document-title";

describe("document title", () => {
  it("builds titles for top, search, and FAQ routes", () => {
    expect(
      titleForAppView({
        activeTabId: "top",
        pathname: "/",
        trackTitle: null,
        trackArtist: null,
      }),
    ).toBe("Top Tracks | Forever Jukebox");
    expect(
      titleForAppView({
        activeTabId: "search",
        pathname: "/search",
        trackTitle: null,
        trackArtist: null,
      }),
    ).toBe("Search | Forever Jukebox");
    expect(
      titleForAppView({
        activeTabId: "faq",
        pathname: "/whats-new",
        trackTitle: null,
        trackArtist: null,
      }),
    ).toBe("What's New | Forever Jukebox");
  });

  it("uses loaded track metadata on the Listen route", () => {
    expect(
      titleForAppView({
        activeTabId: "play",
        pathname: "/listen/abc",
        trackTitle: "Song",
        trackArtist: "Artist",
      }),
    ).toBe("Song - Artist | Forever Jukebox");
    expect(
      titleForAppView({
        activeTabId: "play",
        pathname: "/listen",
        trackTitle: null,
        trackArtist: null,
      }),
    ).toBe("Listen | Forever Jukebox");
  });
});
