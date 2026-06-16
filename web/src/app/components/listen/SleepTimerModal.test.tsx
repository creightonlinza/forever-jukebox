import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setSleepTimer } from "../../playback";
import { useAppStore } from "../../store";
import { SleepTimerModal } from "./SleepTimerModal";

vi.mock("../../playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../playback")>();
  return { ...actual, setSleepTimer: vi.fn() };
});

const FIFTEEN_MIN = 15 * 60 * 1000;

function select() {
  return document.getElementById("sleep-timer-select") as HTMLSelectElement;
}

describe("SleepTimerModal", () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        sleepTimerModalOpen: false,
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
    render(<SleepTimerModal />);
    act(() => {
      useAppStore.setState({ sleepTimerModalOpen: true });
    });
    expect(select().value).toBe(String(FIFTEEN_MIN));
  });

  it("resets the pending select when the configured timer changes externally while open", () => {
    render(<SleepTimerModal />);
    act(() => {
      useAppStore.setState({ sleepTimerModalOpen: true });
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
    render(<SleepTimerModal />);
    act(() => {
      useAppStore.setState({
        sleepTimerModalOpen: true,
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
        <SleepTimerModal />
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
    render(<SleepTimerModal />);
    act(() => {
      useAppStore.setState({ sleepTimerModalOpen: true });
    });
    await userEvent.selectOptions(select(), String(FIFTEEN_MIN));
    await userEvent.click(document.getElementById("sleep-timer-set")!);
    expect(setSleepTimer).toHaveBeenCalledWith(FIFTEEN_MIN);
    expect(useAppStore.getState().sleepTimerModalOpen).toBe(false);
  });
});
