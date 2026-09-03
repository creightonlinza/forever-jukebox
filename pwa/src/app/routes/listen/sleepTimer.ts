import type { TFunction } from "i18next";
import { formatDuration } from "@/shared/utils/format";

export type SleepTimerOption = {
  durationMs: number | null;
};

export type SleepTimerState = {
  configuredDurationMs: number | null;
  endTimeMs: number | null;
  remainingMs: number;
};

export const SLEEP_TIMER_OPTIONS: SleepTimerOption[] = [
  { durationMs: null },
  { durationMs: 15 * 60 * 1000 },
  { durationMs: 30 * 60 * 1000 },
  { durationMs: 45 * 60 * 1000 },
  { durationMs: 60 * 60 * 1000 },
  { durationMs: 2 * 60 * 60 * 1000 },
];

export function getSleepTimerOptionValue(durationMs: number | null) {
  return durationMs === null ? "off" : String(durationMs);
}

export function getSleepTimerDurationFromValue(value: string) {
  if (value === "off") {
    return null;
  }
  const durationMs = Number(value);
  const matchedOption = SLEEP_TIMER_OPTIONS.find(
    (option) => option.durationMs === durationMs,
  );
  return matchedOption ? matchedOption.durationMs : null;
}

export function resolveSleepTimerDuration(durationMs: number | null) {
  return SLEEP_TIMER_OPTIONS.some((option) => option.durationMs === durationMs)
    ? durationMs
    : null;
}

export function formatSleepTimerRemaining(remainingMs: number) {
  return formatDuration(Math.ceil(Math.max(0, remainingMs) / 1000));
}

export function sleepTimerOptionLabel(durationMs: number | null, t: TFunction) {
  if (durationMs === null) {
    return t("sleepTimer.off");
  }
  if (durationMs === 60 * 60 * 1000) {
    return t("sleepTimer.oneHour");
  }
  if (durationMs === 2 * 60 * 60 * 1000) {
    return t("sleepTimer.twoHours");
  }
  return t("sleepTimer.minutes", { count: durationMs / 60_000 });
}
