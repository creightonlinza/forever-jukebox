import React from "react";
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "@forever-jukebox/shared/background";
import { resolveSleepTimerDuration, type SleepTimerState } from "./sleepTimer";

// Countdown that stops playback when it expires; `onExpire` runs before the
// fullscreen exit so the stop happens on the still-fullscreen viz.
export function useSleepTimer({
  isSettingsOpen,
  onExpire,
}: {
  isSettingsOpen: boolean;
  onExpire: () => void;
}) {
  const [sleepTimer, setSleepTimerState] = React.useState<SleepTimerState>({
    configuredDurationMs: null,
    endTimeMs: null,
    remainingMs: 0,
  });
  const [pendingSleepTimerDurationMs, setPendingSleepTimerDurationMs] =
    React.useState<number | null>(null);
  const sleepTimerTimeoutRef = React.useRef<number | null>(null);
  const sleepTimerEndTimeRef = React.useRef<number | null>(null);

  function clearSleepTimerTimeout() {
    if (sleepTimerTimeoutRef.current === null) {
      return;
    }
    backgroundClearTimeout(sleepTimerTimeoutRef.current);
    sleepTimerTimeoutRef.current = null;
  }

  function publishInactiveSleepTimer() {
    sleepTimerEndTimeRef.current = null;
    setSleepTimerState({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
  }

  function expireSleepTimer(expectedEndTimeMs: number) {
    if (sleepTimerEndTimeRef.current !== expectedEndTimeMs) {
      return;
    }
    sleepTimerEndTimeRef.current = null;
    setSleepTimerState({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
    clearSleepTimerTimeout();
    onExpire();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        console.warn("Failed to exit fullscreen");
      });
    }
  }

  function scheduleSleepTimerTick(expectedEndTimeMs: number) {
    clearSleepTimerTimeout();
    const remainingMs = Math.max(0, expectedEndTimeMs - performance.now());
    const nextDelayMs = remainingMs > 1000 ? 1000 : remainingMs;
    sleepTimerTimeoutRef.current = backgroundSetTimeout(() => {
      if (sleepTimerEndTimeRef.current !== expectedEndTimeMs) {
        return;
      }
      const nextRemainingMs = Math.max(0, expectedEndTimeMs - performance.now());
      setSleepTimerState((current) => {
        if (current.endTimeMs !== expectedEndTimeMs) {
          return current;
        }
        return {
          configuredDurationMs: current.configuredDurationMs,
          endTimeMs: expectedEndTimeMs,
          remainingMs: nextRemainingMs,
        };
      });
      if (nextRemainingMs <= 0) {
        expireSleepTimer(expectedEndTimeMs);
        return;
      }
      scheduleSleepTimerTick(expectedEndTimeMs);
    }, nextDelayMs);
  }

  function setSleepTimer(durationMs: number | null) {
    clearSleepTimerTimeout();
    if (
      durationMs === null ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      publishInactiveSleepTimer();
      return;
    }
    const endTimeMs = performance.now() + durationMs;
    sleepTimerEndTimeRef.current = endTimeMs;
    setSleepTimerState({
      configuredDurationMs: durationMs,
      endTimeMs,
      remainingMs: durationMs,
    });
    scheduleSleepTimerTick(endTimeMs);
  }

  React.useEffect(() => {
    setPendingSleepTimerDurationMs(
      resolveSleepTimerDuration(sleepTimer.configuredDurationMs),
    );
  }, [sleepTimer.configuredDurationMs]);

  React.useEffect(() => {
    if (isSettingsOpen) {
      setPendingSleepTimerDurationMs(
        resolveSleepTimerDuration(sleepTimer.configuredDurationMs),
      );
    }
  }, [isSettingsOpen, sleepTimer.configuredDurationMs]);

  React.useEffect(() => {
    return () => {
      clearSleepTimerTimeout();
    };
  }, []);

  return {
    sleepTimer,
    pendingSleepTimerDurationMs,
    setPendingSleepTimerDurationMs,
    setSleepTimer,
  };
}
