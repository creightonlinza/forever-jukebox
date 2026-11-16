import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadUrl } from "../__tests__/test-utils";
import { useAppStore } from "../store";
import { FaqPanel } from "./FaqPanel";

function renderFaqPanel(initialPath = "/faq") {
  loadUrl(initialPath);
  render(<FaqPanel />);
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
    renderFaqPanel("/faq");
    const whatsNewButton = document.querySelector<HTMLButtonElement>(
      '[data-faq-subtab="whats-new"]',
    );
    const faqButton = document.querySelector<HTMLButtonElement>(
      '[data-faq-subtab="faq"]',
    );
    await userEvent.click(whatsNewButton!);
    expect(window.location.pathname).toBe("/whats-new");
    await waitFor(() => {
      expect(document.getElementById("faq-panel-title")?.textContent).toBe(
        "What's New",
      );
    });
    await userEvent.click(faqButton!);
    expect(window.location.pathname).toBe("/faq");
  });
});
