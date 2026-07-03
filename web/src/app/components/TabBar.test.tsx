import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { useAppStore } from "../store";
import { NavigationDriver } from "./NavigationDriver";
import { TabBar } from "./TabBar";

const initialStoreState = useAppStore.getState();

function renderTabBar() {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <NavigationDriver />
            <TabBar />
          </>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

describe("TabBar", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState(initialStoreState, true);
      useAppStore.setState({ activeTabId: "top", isPlayTabPulsing: false });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the four tabs and the offline link", () => {
    renderTabBar();
    expect(screen.getByText("Top Tracks")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Listen")).toBeTruthy();
    expect(screen.getByText("FAQ")).toBeTruthy();
    const offline = screen.getByText("Offline App").closest("a");
    expect(offline?.getAttribute("href")).toBe("/offline/");
    expect(offline?.getAttribute("target")).toBe("_blank");
  });

  it("renders tabs as crawlable links with real hrefs", () => {
    renderTabBar();
    expect(screen.getByText("Top Tracks").closest("a")?.getAttribute("href")).toBe("/");
    expect(screen.getByText("Search").closest("a")?.getAttribute("href")).toBe("/search");
    expect(screen.getByText("Listen").closest("a")?.getAttribute("href")).toBe("/listen");
    expect(screen.getByText("FAQ").closest("a")?.getAttribute("href")).toBe("/faq");
  });

  it("marks the active tab from the store", () => {
    renderTabBar();
    const topTab = screen.getByText("Top Tracks").closest("a");
    const searchTab = screen.getByText("Search").closest("a");
    expect(topTab?.className).toContain("active");
    expect(searchTab?.className).not.toContain("active");
    act(() => {
      useAppStore.getState().setActiveTab("search");
    });
    expect(topTab?.className).not.toContain("active");
    expect(searchTab?.className).toContain("active");
  });

  it("pulses the Listen tab while audio runs on other tabs", () => {
    renderTabBar();
    const playTab = screen.getByText("Listen").closest("a");
    expect(playTab?.className).not.toContain("is-playing");
    act(() => {
      useAppStore.getState().setPlayTabPulsing(true);
    });
    expect(playTab?.className).toContain("is-playing");
  });

  it("navigates via the store's selectTab action on click", async () => {
    const { router } = renderTabBar();
    await userEvent.click(screen.getByText("Search"));
    expect(useAppStore.getState().activeTabId).toBe("search");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/search");
    });
    await userEvent.click(screen.getByText("FAQ"));
    expect(useAppStore.getState().activeTabId).toBe("faq");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/faq");
    });
  });
});
