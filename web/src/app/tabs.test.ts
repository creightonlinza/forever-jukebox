import { describe, expect, it, beforeEach } from "vitest";
import {
  navigateToFaqSubtab,
  navigateToTab,
  pathForFaqSubtab,
  pathForTab,
  updateTrackUrl,
} from "./tabs";
import { setWindowUrl } from "./__tests__/test-utils";

describe("tabs", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/");
  });

  it("builds paths for tabs", () => {
    expect(pathForTab("top")).toBe("/");
    expect(pathForTab("search")).toBe("/search");
    expect(pathForTab("play")).toBe("/listen");
    expect(pathForTab("play", "abc123")).toBe("/listen/abc123");
    expect(pathForTab("faq")).toBe("/faq");
  });

  it("builds paths for FAQ subtabs", () => {
    expect(pathForFaqSubtab("faq")).toBe("/faq");
    expect(pathForFaqSubtab("whats-new")).toBe("/whats-new");
  });

  it("navigates and clears search on non-play tabs", () => {
    setWindowUrl("http://localhost/listen/abc?jb=1");
    navigateToTab("top", { replace: true });
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });

  it("navigates to play and preserves tuning params", () => {
    navigateToTab(
      "play",
      { replace: true, youtubeId: "abc123" },
      null,
      "jb=1&thresh=20",
      "jukebox",
    );
    expect(window.location.pathname).toBe("/listen/abc123");
    expect(window.location.search).toBe("?jb=1&thresh=20");
  });

  it("updates track URL with tuning params", () => {
    updateTrackUrl("xyz", true, "lg=1", "jukebox");
    expect(window.location.pathname).toBe("/listen/xyz");
    expect(window.location.search).toBe("?lg=1");
  });

  it("updates track URL with audio mode tuning param", () => {
    updateTrackUrl("xyz", true, "am=nightcore", "jukebox");
    expect(window.location.pathname).toBe("/listen/xyz");
    expect(window.location.search).toBe("?am=nightcore");
  });

  it("adds mode param for autocanonizer", () => {
    updateTrackUrl("xyz", true, "lg=1", "autocanonizer");
    expect(window.location.pathname).toBe("/listen/xyz");
    expect(window.location.search).toBe("?mode=autocanonizer");
  });

  it("navigates to FAQ subtabs", () => {
    navigateToFaqSubtab("whats-new", { replace: true });
    expect(window.location.pathname).toBe("/whats-new");
    expect(window.location.search).toBe("");
    navigateToFaqSubtab("faq", { replace: true });
    expect(window.location.pathname).toBe("/faq");
  });
});
