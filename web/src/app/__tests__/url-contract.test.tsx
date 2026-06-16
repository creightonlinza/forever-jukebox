import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { NavigationDriver } from "../components/NavigationDriver";
import { useAppStore } from "../store";
import {
  pathForFaqSubtab,
  pathForTab,
  pathForTrack,
  tabFromPathname,
  urlForTrack,
} from "../tabs";

// The frozen URL contract (see e2e/README.md and git history of the
// migration plan). These tests pin the exact paths/search strings queued for
// React Router plus the pure URL helpers used for links.

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialStoreState, true);
});

afterEach(() => {
  cleanup();
});

function expectNavigationRequest(to: string, replace?: boolean) {
  expect(useAppStore.getState().navigationRequest).toEqual({
    id: 1,
    to,
    replace,
  });
}

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

  it("queues non-play tab navigation without search params", () => {
    useAppStore.setState({ tuningParams: "jb=1&thresh=20" });
    useAppStore.getState().navigateToTabWithState("top", { replace: true });
    expect(useAppStore.getState().activeTabId).toBe("top");
    expectNavigationRequest("/", true);
  });

  it("queues play tab navigation with tuning params", () => {
    useAppStore.setState({
      playMode: "jukebox",
      tuningParams: "jb=1&thresh=20",
    });
    useAppStore
      .getState()
      .navigateToTabWithState("play", { replace: true, trackId: "abc123" });
    expect(useAppStore.getState().activeTabId).toBe("play");
    expectNavigationRequest("/listen/abc123?jb=1&thresh=20", true);
  });

  it("queues track URL updates with tuning params, replace vs push", () => {
    useAppStore.setState({
      playMode: "jukebox",
      tuningParams: "lg=1",
    });
    useAppStore
      .getState()
      .navigateToTrackWithState("xyz", { replace: true });
    expectNavigationRequest("/listen/xyz?lg=1", true);

    useAppStore
      .getState()
      .navigateToTrackWithState("xyz", { replace: false });
    expect(useAppStore.getState().navigationRequest).toEqual({
      id: 2,
      to: "/listen/xyz?lg=1",
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
    expect(
      urlForTrack("abc123", "https://example.test/top", null, "jukebox"),
    ).toBe("https://example.test/listen/abc123");
  });

  it("carries the audio-mode tuning param", () => {
    expect(pathForTrack("xyz", "am=nightcore", "jukebox")).toBe(
      "/listen/xyz?am=nightcore",
    );
  });

  it("adds the mode param for autocanonizer and drops tuning params", () => {
    useAppStore.setState({
      playMode: "autocanonizer",
      tuningParams: "lg=1",
    });
    useAppStore
      .getState()
      .navigateToTrackWithState("xyz", { replace: true });
    expectNavigationRequest("/listen/xyz?mode=autocanonizer", true);
  });

  it("encodes track ids in listen paths", () => {
    expect(pathForTab("play", "a b/c")).toBe("/listen/a%20b%2Fc");
  });

  it("drives React Router from queued navigation requests", async () => {
    const router = createMemoryRouter(
      [{ path: "*", element: <NavigationDriver /> }],
      {
        initialEntries: ["/listen/abc?jb=1"],
      },
    );
    render(<RouterProvider router={router} />);

    act(() => {
      useAppStore
        .getState()
        .navigateToTrackWithState("xyz", {
          replace: true,
          tuningParams: "lg=1",
          playMode: "jukebox",
        });
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/listen/xyz");
      expect(router.state.location.search).toBe("?lg=1");
    });
  });
});
