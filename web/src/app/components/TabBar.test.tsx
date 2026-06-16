import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../store";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ activeTabId: "top", isPlayTabPulsing: false });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the four tabs and the offline link", () => {
    render(<TabBar />);
    expect(screen.getByText("Top Tracks")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Listen")).toBeTruthy();
    expect(screen.getByText("FAQ")).toBeTruthy();
    const offline = screen.getByText("Offline App").closest("a");
    expect(offline?.getAttribute("href")).toBe("/offline/");
    expect(offline?.getAttribute("target")).toBe("_blank");
  });

  it("marks the active tab from the store", () => {
    render(<TabBar />);
    const topButton = screen.getByText("Top Tracks").closest("button");
    const searchButton = screen.getByText("Search").closest("button");
    expect(topButton?.className).toContain("active");
    expect(searchButton?.className).not.toContain("active");
    act(() => {
      useAppStore.getState().setActiveTab("search");
    });
    expect(topButton?.className).not.toContain("active");
    expect(searchButton?.className).toContain("active");
  });

  it("pulses the Listen tab while audio runs on other tabs", () => {
    render(<TabBar />);
    const playButton = screen.getByText("Listen").closest("button");
    expect(playButton?.className).not.toContain("is-playing");
    act(() => {
      useAppStore.getState().setPlayTabPulsing(true);
    });
    expect(playButton?.className).toContain("is-playing");
  });

  it("navigates via the store's selectTab action on click", async () => {
    render(<TabBar />);
    await userEvent.click(screen.getByText("Search"));
    expect(useAppStore.getState().activeTabId).toBe("search");
    expect(window.location.pathname).toBe("/search");
    await userEvent.click(screen.getByText("FAQ"));
    expect(useAppStore.getState().activeTabId).toBe("faq");
    expect(window.location.pathname).toBe("/faq");
  });
});
