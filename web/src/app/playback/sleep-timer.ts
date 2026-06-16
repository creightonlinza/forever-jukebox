import type { AppContext, SleepTimerState } from "../context";
import { useAppStore } from "../store";
import { getAppContext } from "../runtime";
import {
  backgroundClearTimeout,
  backgroundSetTimeout,
} from "@forever-jukebox/engine/background";
import { stopPlayback } from "./transport";

export type SleepTimerOption = {
  label: string;
  durationMs: number | null;
};

export const SLEEP_TIMER_OPTIONS: SleepTimerOption[] = [
  { label: "Off", durationMs: null },
  { label: "15 minutes", durationMs: 15 * 60 * 1000 },
  { label: "30 minutes", durationMs: 30 * 60 * 1000 },
  { label: "45 minutes", durationMs: 45 * 60 * 1000 },
  { label: "1 hour", durationMs: 60 * 60 * 1000 },
  { label: "2 hours", durationMs: 2 * 60 * 60 * 1000 },
];

const sleepTimerListeners = new WeakMap<AppContext, Set<() => void>>();

export function isSleepTimerActive(state: SleepTimerState) {
  return state.endTimeMs !== null && state.remainingMs > 0;
}

export function addSleepTimerListener(
  context: AppContext,
  listener: () => void,
) {
  let listeners = sleepTimerListeners.get(context);
  if (!listeners) {
    listeners = new Set();
    sleepTimerListeners.set(context, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
  };
}

function publishSleepTimerState(context: AppContext) {
  sleepTimerListeners.get(context)?.forEach((listener) => listener());
}

function clearSleepTimerTimeout() {
  const { sleepTimerTimeoutId } = useAppStore.getState();
  if (sleepTimerTimeoutId === null) {
    return;
  }
  backgroundClearTimeout(sleepTimerTimeoutId);
  useAppStore.setState({ sleepTimerTimeoutId: null });
}

function publishInactiveSleepTimer(context: AppContext) {
  useAppStore.setState({
    sleepTimer: {
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    },
  });
  publishSleepTimerState(context);
}

function expireSleepTimer(context: AppContext, expectedEndTimeMs: number) {
  if (useAppStore.getState().sleepTimer.endTimeMs !== expectedEndTimeMs) {
    return;
  }
  clearSleepTimerTimeout();
  publishInactiveSleepTimer(context);
  stopPlayback(context);
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {
      console.warn("Failed to exit fullscreen");
    });
  }
}

function scheduleSleepTimerTick(context: AppContext, expectedEndTimeMs: number) {
  clearSleepTimerTimeout();
  const remainingMs = Math.max(0, expectedEndTimeMs - performance.now());
  const nextDelayMs = remainingMs > 1000 ? 1000 : remainingMs;
  const timeoutId = backgroundSetTimeout(() => {
    if (useAppStore.getState().sleepTimer.endTimeMs !== expectedEndTimeMs) {
      return;
    }
    const nextRemainingMs = Math.max(0, expectedEndTimeMs - performance.now());
    useAppStore.setState({
      sleepTimer: {
        configuredDurationMs: useAppStore.getState().sleepTimer.configuredDurationMs,
        endTimeMs: expectedEndTimeMs,
        remainingMs: nextRemainingMs,
      },
    });
    publishSleepTimerState(context);
    if (nextRemainingMs <= 0) {
      expireSleepTimer(context, expectedEndTimeMs);
      return;
    }
    scheduleSleepTimerTick(context, expectedEndTimeMs);
  }, nextDelayMs);
  useAppStore.setState({ sleepTimerTimeoutId: timeoutId });
}

export function setSleepTimer(durationMs: number | null) {
  const context = getAppContext();
  clearSleepTimerTimeout();
  if (
    durationMs === null ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    publishInactiveSleepTimer(context);
    return;
  }
  const endTimeMs = performance.now() + durationMs;
  useAppStore.setState({
    sleepTimer: {
      configuredDurationMs: durationMs,
      endTimeMs,
      remainingMs: durationMs,
    },
  });
  publishSleepTimerState(context);
  scheduleSleepTimerTick(context, endTimeMs);
}
