import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { appNavigate, setAppRouter, type AppRouter } from "../router";
import {
  navigateToFaqSubtab,
  navigateToTab,
  pathForFaqSubtab,
  pathForTab,
  tabFromPathname,
  updateTrackUrl,
  urlForTrack,
} from "../tabs";

// The frozen URL contract (REACT_MIGRATION.md Phase 2). These tests replace
// tabs.test.ts and pin the exact paths/search strings the router receives.

function spyRouter() {
  const navigate = vi.fn();
  setAppRouter({ navigate } as unknown as AppRouter);
  return navigate;
}

afterEach(() => {
  setAppRouter(null);
  cleanup();
});

describe("URL contract", () => {
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

  it("derives the active tab from the pathname", () => {
    expect(tabFromPathname("/")).toBe("top");
    expect(tabFromPathname("/search")).toBe("search");
    expect(tabFromPathname("/listen")).toBe("play");
    expect(tabFromPathname("/listen/abc123")).toBe("play");
    expect(tabFromPathname("/faq")).toBe("faq");
    expect(tabFromPathname("/whats-new")).toBe("faq");
    expect(tabFromPathname("/unknown")).toBe("top");
  });

  it("strips search params when navigating to non-play tabs", () => {
    const navigate = spyRouter();
    navigateToTab("top", { replace: true });
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("preserves tuning params when navigating to play", () => {
    const navigate = spyRouter();
    navigateToTab(
      "play",
      { replace: true, trackId: "abc123" },
      null,
      "jb=1&thresh=20",
      "jukebox",
    );
    expect(navigate).toHaveBeenCalledWith("/listen/abc123?jb=1&thresh=20", {
      replace: true,
    });
  });

  it("updates track URL with tuning params, replace vs push", () => {
    const navigate = spyRouter();
    updateTrackUrl("xyz", true, "lg=1", "jukebox");
    expect(navigate).toHaveBeenLastCalledWith("/listen/xyz?lg=1", {
      replace: true,
    });
    updateTrackUrl("xyz", false, "lg=1", "jukebox");
    expect(navigate).toHaveBeenLastCalledWith("/listen/xyz?lg=1", {
      replace: false,
    });
  });

  it("keeps comma-separated tuning values unescaped and ordered", () => {
    const href = urlForTrack(
      "a3f3c0dc73c6476c9db95c227f9206f2",
      "https://example.test/current?old=1",
      "jb=1&d=2,8&am=nightcore",
      "jukebox",
    );
    expect(href).toBe(
      "https://example.test/listen/a3f3c0dc73c6476c9db95c227f9206f2?jb=1&d=2,8&am=nightcore",
    );
  });

  it("builds track URLs without search when tuning is absent", () => {
    expect(urlForTrack("abc123", "https://example.test/top", null, "jukebox")).toBe(
      "https://example.test/listen/abc123",
    );
  });

  it("carries the audio-mode tuning param", () => {
    const navigate = spyRouter();
    updateTrackUrl("xyz", true, "am=nightcore", "jukebox");
    expect(navigate).toHaveBeenCalledWith("/listen/xyz?am=nightcore", {
      replace: true,
    });
  });

  it("adds the mode param for autocanonizer and drops tuning params", () => {
    const navigate = spyRouter();
    updateTrackUrl("xyz", true, "lg=1", "autocanonizer");
    expect(navigate).toHaveBeenCalledWith("/listen/xyz?mode=autocanonizer", {
      replace: true,
    });
  });

  it("navigates FAQ subtabs with empty search", () => {
    const navigate = spyRouter();
    navigateToFaqSubtab("whats-new", { replace: true });
    expect(navigate).toHaveBeenCalledWith("/whats-new", { replace: true });
    navigateToFaqSubtab("faq");
    expect(navigate).toHaveBeenLastCalledWith("/faq", { replace: undefined });
  });

  it("encodes track ids in listen paths", () => {
    expect(pathForTab("play", "a b/c")).toBe("/listen/a%20b%2Fc");
  });

  it("routes appNavigate through a mounted router", () => {
    const router = createMemoryRouter([{ path: "*", element: <div /> }], {
      initialEntries: ["/listen/abc?jb=1"],
    });
    render(<RouterProvider router={router} />);
    setAppRouter(router);
    appNavigate("/search", { replace: true });
    expect(router.state.location.pathname).toBe("/search");
    expect(router.state.location.search).toBe("");
  });

  it("falls back to history when no router is mounted", () => {
    setAppRouter(null);
    const replaceState = vi.spyOn(window.history, "replaceState");
    appNavigate("/listen/abc?jb=1", { replace: true });
    expect(replaceState).toHaveBeenCalledWith(
      {},
      "",
      expect.stringContaining("/listen/abc?jb=1"),
    );
    replaceState.mockRestore();
  });
});
