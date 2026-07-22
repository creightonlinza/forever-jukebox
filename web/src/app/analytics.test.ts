// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAnalyticsForTests,
  trackEvent,
  trackPageView,
  trackPlay,
} from "./analytics";

describe("analytics", () => {
  const gtag = vi.fn();

  beforeEach(() => {
    window.gtag = gtag;
    resetAnalyticsForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.gtag;
  });

  it("is a no-op when gtag is absent", () => {
    delete window.gtag;
    expect(() => {
      trackEvent("share", { track_id: "x" });
      trackPageView("/faq");
      trackPlay("jukebox", "x", "Song");
    }).not.toThrow();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("forwards events with params", () => {
    trackEvent("share", { track_id: "abc" });
    expect(gtag).toHaveBeenCalledWith("event", "share", { track_id: "abc" });
  });

  it("suppresses a page_view for the landing path but fires on navigation", () => {
    trackPageView(window.location.pathname);
    expect(gtag).not.toHaveBeenCalled();

    trackPageView("/faq");
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "page_view",
      expect.objectContaining({ page_path: "/faq" }),
    );

    trackPageView("/faq");
    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("dedupes plays per track and mode", () => {
    trackPlay("jukebox", "a", "Song A");
    trackPlay("jukebox", "a", "Song A");
    expect(gtag).toHaveBeenCalledTimes(1);

    trackPlay("autocanonizer", "a", "Song A");
    trackPlay("jukebox", "b", "Song B");
    expect(gtag).toHaveBeenCalledTimes(3);
  });
});
