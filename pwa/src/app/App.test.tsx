import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./i18n";
import { App } from "./App";
import { PLAY_BADGE_URL, PLAY_STORE_URL } from "./constants";

const installPromptState = {
  canInstall: false,
  isGateUnlocked: true,
  promptInstall: vi.fn(),
};

vi.mock("./hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => installPromptState,
}));

const platformState = { isAndroid: false };

vi.mock("@/shared/utils/platform", () => ({
  isAndroid: () => platformState.isAndroid,
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

beforeEach(() => {
  installPromptState.canInstall = false;
  installPromptState.isGateUnlocked = true;
  installPromptState.promptInstall = vi.fn();
  platformState.isAndroid = false;
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

describe("Install gate", () => {
  it("links to Google Play and hides the app while gate is locked", () => {
    installPromptState.isGateUnlocked = false;
    render(<App />);

    const playLink = screen.getByRole("link", {
      name: "Get it on Google Play",
    });
    expect(playLink.getAttribute("href")).toBe(PLAY_STORE_URL);
    expect(playLink.getAttribute("target")).toBe("_blank");
    expect(playLink.getAttribute("rel")).toBe("noopener noreferrer");
    const badge = playLink.querySelector("img");
    expect(badge?.getAttribute("src")).toBe(PLAY_BADGE_URL);
    expect(PLAY_BADGE_URL).toContain("badges/en_badge_web_generic.png");
    expect(
      screen.queryByRole("button", { name: "Install web app" }),
    ).toBeNull();
    expect(document.getElementById("settings-open")).toBeNull();
  });

  it("shows the web app option first on non-Android platforms", () => {
    installPromptState.isGateUnlocked = false;
    render(<App />);

    const options = document.querySelectorAll(".install-gate__option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Install app/Add to Home Screen");
    expect(options[0].classList.contains("install-gate__option--secondary"))
      .toBe(false);
    expect(options[1].querySelector(".install-gate__play")).not.toBeNull();
    expect(options[1].classList.contains("install-gate__option--secondary"))
      .toBe(true);
  });

  it("shows the Google Play option first on Android", () => {
    installPromptState.isGateUnlocked = false;
    platformState.isAndroid = true;
    render(<App />);

    const options = document.querySelectorAll(".install-gate__option");
    expect(options[0].querySelector(".install-gate__play")).not.toBeNull();
    expect(options[0].classList.contains("install-gate__option--secondary"))
      .toBe(false);
    expect(options[1].classList.contains("install-gate__option--secondary"))
      .toBe(true);
  });

  it("prompts the browser install when available", async () => {
    installPromptState.isGateUnlocked = false;
    installPromptState.canInstall = true;
    installPromptState.promptInstall = vi.fn().mockResolvedValue("accepted");
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: "Install web app" }),
    );
    expect(installPromptState.promptInstall).toHaveBeenCalledOnce();
  });
});
