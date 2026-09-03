import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  SLEEP_TIMER_OPTIONS,
  formatSleepTimerRemaining,
  getSleepTimerDurationFromValue,
  getSleepTimerOptionValue,
  resolveSleepTimerDuration,
  sleepTimerOptionLabel,
} from "./sleepTimer";

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe("sleep timer helpers", () => {
  it("maps option values to durations and back", () => {
    expect(getSleepTimerOptionValue(null)).toBe("off");
    expect(getSleepTimerOptionValue(900_000)).toBe("900000");
    expect(getSleepTimerDurationFromValue("off")).toBeNull();
    expect(getSleepTimerDurationFromValue("900000")).toBe(900_000);
    expect(getSleepTimerDurationFromValue("123")).toBeNull();
    expect(getSleepTimerDurationFromValue("nope")).toBeNull();
  });

  it("only accepts durations from the option list", () => {
    for (const option of SLEEP_TIMER_OPTIONS) {
      expect(resolveSleepTimerDuration(option.durationMs)).toBe(option.durationMs);
    }
    expect(resolveSleepTimerDuration(123)).toBeNull();
  });

  it("formats the remaining time rounded up to whole seconds", () => {
    expect(formatSleepTimerRemaining(59_001)).toBe("00:01:00");
    expect(formatSleepTimerRemaining(1_000)).toBe("00:00:01");
    expect(formatSleepTimerRemaining(-5_000)).toBe("00:00:00");
  });

  it("labels options through translation keys", () => {
    expect(sleepTimerOptionLabel(null, t)).toBe("sleepTimer.off");
    expect(sleepTimerOptionLabel(60 * 60 * 1000, t)).toBe("sleepTimer.oneHour");
    expect(sleepTimerOptionLabel(2 * 60 * 60 * 1000, t)).toBe("sleepTimer.twoHours");
    expect(sleepTimerOptionLabel(15 * 60 * 1000, t)).toBe(
      'sleepTimer.minutes:{"count":15}',
    );
  });
});
