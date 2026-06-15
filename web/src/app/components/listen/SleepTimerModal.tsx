import { useEffect, useRef, useState } from "react";
import type { AppBridge } from "../../bridge";
import { formatDuration } from "../../format";
import { SLEEP_TIMER_OPTIONS } from "../../playback";
import { useAppStore } from "../../store";
import { Modal } from "../Modal";

function valueForDuration(durationMs: number | null) {
  return durationMs === null ? "off" : String(durationMs);
}

function durationFromValue(value: string) {
  if (value === "off") {
    return null;
  }
  const durationMs = Number(value);
  const matched = SLEEP_TIMER_OPTIONS.find(
    (option) => option.durationMs === durationMs,
  );
  return matched ? matched.durationMs : null;
}

function resolveConfiguredDuration(configuredDurationMs: number | null) {
  return SLEEP_TIMER_OPTIONS.some(
    (option) => option.durationMs === configuredDurationMs,
  )
    ? configuredDurationMs
    : null;
}

export function SleepTimerModal({ bridge }: { bridge: AppBridge }) {
  const open = useAppStore((s) => s.sleepTimerModalOpen);
  // sleepTimer is replaced every second while a countdown runs (up to 2h), so
  // subscribing to the whole object would re-render this modal every tick even
  // while it's closed. Track configuredDurationMs (changes only on set/expire)
  // and read the live remainingMs only while open.
  const configuredDurationMs = useAppStore(
    (s) => s.sleepTimer.configuredDurationMs,
  );
  const remainingMs = useAppStore((s) =>
    s.sleepTimerModalOpen ? s.sleepTimer.remainingMs : 0,
  );
  const [pendingValue, setPendingValue] = useState("off");
  const appliedRef = useRef<number | null>(null);

  // On open, show the currently configured timer.
  useEffect(() => {
    if (open) {
      const applied = resolveConfiguredDuration(
        useAppStore.getState().sleepTimer.configuredDurationMs,
      );
      appliedRef.current = applied;
      setPendingValue(valueForDuration(applied));
    }
  }, [open]);

  // When the applied timer changes externally (set/expired), the select
  // resets to it.
  useEffect(() => {
    const applied = resolveConfiguredDuration(configuredDurationMs);
    if (applied !== appliedRef.current) {
      appliedRef.current = applied;
      setPendingValue(valueForDuration(applied));
    }
  }, [configuredDurationMs]);

  const close = () => useAppStore.setState({ sleepTimerModalOpen: false });

  const countdown =
    remainingMs > 0
      ? `Current countdown: ${formatDuration(
          Math.ceil(Math.max(0, remainingMs) / 1000),
        )}`
      : "Off";

  return (
    <Modal
      id="sleep-timer-modal"
      open={open}
      onClose={close}
      panelClassName="sleep-timer-panel"
    >
      <div className="modal-header">
        <h2>Sleep Timer</h2>
        <button
          id="sleep-timer-close"
          className="modal-close"
          aria-label="Close"
          onClick={close}
        >
          <span
            className="material-symbols-outlined modal-close-icon"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </div>
      <div className="modal-body sleep-timer-body">
        <div id="sleep-timer-current" className="sleep-timer-current">
          {countdown}
        </div>
        <label className="sleep-timer-select-group" htmlFor="sleep-timer-select">
          <span className="label-line">Timer</span>
          <span className="viz-select-wrap sleep-timer-select-wrap">
            <select
              id="sleep-timer-select"
              className="viz-select sleep-timer-select"
              value={pendingValue}
              onChange={(event) => setPendingValue(event.target.value)}
            >
              {SLEEP_TIMER_OPTIONS.map((option) => (
                <option
                  key={option.label}
                  value={valueForDuration(option.durationMs)}
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span
              className="material-symbols-outlined viz-select-arrow"
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
          </span>
        </label>
      </div>
      <div className="modal-footer sleep-timer-footer">
        <button id="sleep-timer-cancel" type="button" onClick={close}>
          Close
        </button>
        <button
          id="sleep-timer-set"
          type="button"
          onClick={() => {
            bridge.listenPanel.setSleepTimer(durationFromValue(pendingValue));
            close();
          }}
        >
          Set
        </button>
      </div>
    </Modal>
  );
}
