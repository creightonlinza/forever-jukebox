import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { useAppStore } from "../store";
import { FaqPanel } from "./FaqPanel";

function renderFaqPanel(initialPath = "/faq") {
  const router = createMemoryRouter(
    [{ path: "*", element: <FaqPanel /> }],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

describe("FaqPanel", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ activeTabId: "faq" });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the FAQ subtab content on /faq", () => {
    renderFaqPanel("/faq");
    expect(document.getElementById("faq-panel-title")?.textContent).toBe("FAQ");
    expect(
      document.getElementById("faq-panel")?.classList.contains("hidden"),
    ).toBe(false);
    expect(
      document
        .getElementById("faq-whats-new-panel")
        ?.classList.contains("hidden"),
    ).toBe(true);
    expect(screen.getByText("What the what?")).toBeTruthy();
  });

  it("shows What's New on /whats-new", () => {
    renderFaqPanel("/whats-new");
    expect(document.getElementById("faq-panel-title")?.textContent).toBe(
      "What's New",
    );
    expect(
      document.getElementById("faq-panel")?.classList.contains("hidden"),
    ).toBe(true);
    expect(
      document
        .getElementById("faq-whats-new-panel")
        ?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("navigates between subtabs on click", async () => {
    const { router } = renderFaqPanel("/faq");
    const whatsNewButton = document.querySelector<HTMLButtonElement>(
      '[data-faq-subtab="whats-new"]',
    );
    const faqButton = document.querySelector<HTMLButtonElement>(
      '[data-faq-subtab="faq"]',
    );
    await userEvent.click(whatsNewButton!);
    expect(router.state.location.pathname).toBe("/whats-new");
    await waitFor(() => {
      expect(document.getElementById("faq-panel-title")?.textContent).toBe(
        "What's New",
      );
    });
    await userEvent.click(faqButton!);
    expect(router.state.location.pathname).toBe("/faq");
  });
});
