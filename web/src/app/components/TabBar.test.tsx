import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useShellStore } from "../shell-store";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  beforeEach(() => {
    act(() => {
      useShellStore.setState({ activeTab: "top", isPlayTabPulsing: false });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the four tabs and the offline link", () => {
    render(<TabBar bridge={{ onTabClick: vi.fn() }} />);
    expect(screen.getByText("Top Tracks")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Listen")).toBeTruthy();
    expect(screen.getByText("FAQ")).toBeTruthy();
    const offline = screen.getByText("Offline App").closest("a");
    expect(offline?.getAttribute("href")).toBe("/offline/");
    expect(offline?.getAttribute("target")).toBe("_blank");
  });

  it("marks the active tab from the store", () => {
    render(<TabBar bridge={{ onTabClick: vi.fn() }} />);
    const topButton = screen.getByText("Top Tracks").closest("button");
    const searchButton = screen.getByText("Search").closest("button");
    expect(topButton?.className).toContain("active");
    expect(searchButton?.className).not.toContain("active");
    act(() => {
      useShellStore.getState().setActiveTab("search");
    });
    expect(topButton?.className).not.toContain("active");
    expect(searchButton?.className).toContain("active");
  });

  it("pulses the Listen tab while audio runs on other tabs", () => {
    render(<TabBar bridge={{ onTabClick: vi.fn() }} />);
    const playButton = screen.getByText("Listen").closest("button");
    expect(playButton?.className).not.toContain("is-playing");
    act(() => {
      useShellStore.getState().setPlayTabPulsing(true);
    });
    expect(playButton?.className).toContain("is-playing");
  });

  it("delegates clicks to the bridge", async () => {
    const onTabClick = vi.fn();
    render(<TabBar bridge={{ onTabClick }} />);
    await userEvent.click(screen.getByText("Search"));
    expect(onTabClick).toHaveBeenCalledWith("search");
    await userEvent.click(screen.getByText("FAQ"));
    expect(onTabClick).toHaveBeenCalledWith("faq");
  });
});
