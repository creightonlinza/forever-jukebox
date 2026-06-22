import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./i18n";
import { App } from "./App";

vi.mock("./hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => ({
    canInstall: false,
    isGateUnlocked: true,
    promptInstall: vi.fn(),
  }),
}));

vi.mock("./routes/Home", () => ({
  Home: () => <div>Home</div>,
}));

vi.mock("./routes/Faq", () => ({
  Faq: () => <div>FAQ</div>,
}));

vi.mock("./routes/Listen", async () => {
  const { useAppState } = await import("./state/AppState");
  return {
    Listen: () => {
    const { isSettingsOpen } = useAppState();
    return (
      <div data-testid="settings-state">
        {isSettingsOpen ? "open" : "closed"}
      </div>
    );
    },
  };
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("App header", () => {
  it("opens settings from an accessible gear button", async () => {
    render(<App />);

    const button = document.getElementById("settings-open");
    expect(button?.getAttribute("aria-label")).toBe("Open settings");
    await userEvent.click(button!);

    expect(
      document.querySelector('[data-testid="settings-state"]')?.textContent,
    ).toBe("open");
  });
});
