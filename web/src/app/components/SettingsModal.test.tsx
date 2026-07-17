import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setSleepTimer } from "../playback";
import { useAppStore } from "../store";
import { SettingsModal } from "./SettingsModal";

vi.mock("../playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../playback")>();
  return { ...actual, setSleepTimer: vi.fn() };
});

const FIFTEEN_MIN = 15 * 60 * 1000;

function select() {
  return document.getElementById("sleep-timer-select") as HTMLSelectElement;
}

describe("SettingsModal", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        settingsModalOpen: false,
        theme: "dark",
        sleepTimer: {
          configuredDurationMs: null,
          endTimeMs: null,
          remainingMs: 0,
        },
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the configured timer when opened", () => {
    act(() => {
      useAppStore.setState({
        sleepTimer: {
          configuredDurationMs: FIFTEEN_MIN,
          endTimeMs: 1,
          remainingMs: FIFTEEN_MIN,
        },
      });
    });
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    expect(select().value).toBe(String(FIFTEEN_MIN));
  });

  it("resets the pending select when the configured timer changes externally while open", () => {
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    expect(select().value).toBe("off");

    // An external control sets the timer while this modal is open.
    act(() => {
      useAppStore.setState({
        sleepTimer: {
          configuredDurationMs: FIFTEEN_MIN,
          endTimeMs: 1,
          remainingMs: FIFTEEN_MIN,
        },
      });
    });
    expect(select().value).toBe(String(FIFTEEN_MIN));

    // The timer expires: configured goes back to null, select resets to off.
    act(() => {
      useAppStore.setState({
        sleepTimer: {
          configuredDurationMs: null,
          endTimeMs: null,
          remainingMs: 0,
        },
      });
    });
    expect(select().value).toBe("off");
  });

  it("keeps an unsaved selection when only the countdown ticks", () => {
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({
        settingsModalOpen: true,
        sleepTimer: {
          configuredDurationMs: FIFTEEN_MIN,
          endTimeMs: 1,
          remainingMs: FIFTEEN_MIN,
        },
      });
    });
    // User picks a different option but hasn't pressed Set yet.
    act(() => {
      const node = select();
      node.value = "off";
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select().value).toBe("off");

    // A countdown tick (only remainingMs changes) must not clobber the choice.
    act(() => {
      useAppStore.setState({
        sleepTimer: {
          configuredDurationMs: FIFTEEN_MIN,
          endTimeMs: 1,
          remainingMs: FIFTEEN_MIN - 1000,
        },
      });
    });
    expect(select().value).toBe("off");
  });

  it("does not re-render on countdown ticks while closed", () => {
    let renders = 0;
    render(
      <Profiler id="sleep-timer" onRender={() => (renders += 1)}>
        <SettingsModal />
      </Profiler>,
    );
    // Configuring the timer is allowed to re-render once (configured changed).
    act(() => {
      useAppStore.setState({
        sleepTimer: {
          configuredDurationMs: FIFTEEN_MIN,
          endTimeMs: 999,
          remainingMs: FIFTEEN_MIN,
        },
      });
    });
    const afterConfigure = renders;

    // Per-second ticks change only remainingMs; while closed this must not
    // re-render (the regression: subscribing to the whole sleepTimer object).
    for (const remainingMs of [FIFTEEN_MIN - 1000, FIFTEEN_MIN - 2000]) {
      act(() => {
        useAppStore.setState({
          sleepTimer: { configuredDurationMs: FIFTEEN_MIN, endTimeMs: 999, remainingMs },
        });
      });
    }
    expect(renders).toBe(afterConfigure);
  });

  it("sets the chosen timer via the playback action", async () => {
    (setSleepTimer as Mock).mockClear();
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    await userEvent.selectOptions(select(), String(FIFTEEN_MIN));
    await userEvent.click(document.getElementById("sleep-timer-set")!);
    expect(setSleepTimer).toHaveBeenCalledWith(FIFTEEN_MIN);
    expect(useAppStore.getState().settingsModalOpen).toBe(false);
  });

  it("associates the timer label with the select", () => {
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    expect(screen.getByLabelText("Timer")).toBe(select());
  });

  it("applies theme changes immediately", async () => {
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    await userEvent.click(
      document.querySelector<HTMLInputElement>(
        'input[name="settings-theme"][value="light"]',
      )!,
    );
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("closes from the backdrop", async () => {
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    await userEvent.click(document.getElementById("settings-modal")!);
    expect(useAppStore.getState().settingsModalOpen).toBe(false);
  });

  it("discards an uncommitted timer choice when closed", async () => {
    render(<SettingsModal />);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    await userEvent.selectOptions(select(), String(FIFTEEN_MIN));
    await userEvent.click(document.getElementById("settings-close")!);
    act(() => {
      useAppStore.setState({ settingsModalOpen: true });
    });
    expect(select().value).toBe("off");
  });
});
