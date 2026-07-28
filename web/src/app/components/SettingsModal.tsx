import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDuration } from "../format";
import {
  resolveSupportedLanguage,
  supportedLanguageOptions,
} from "../i18n";
import { SLEEP_TIMER_OPTIONS, setSleepTimer } from "../playback";
import { useAppStore } from "../store";
import type { ThemeName } from "../themeConfig";
import { Modal } from "./Modal";

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

function sleepTimerLabel(durationMs: number | null, t: TFunction) {
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

export function SettingsModal() {
  const { t, i18n } = useTranslation();
  const open = useAppStore((state) => state.settingsModalOpen);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const configuredDurationMs = useAppStore(
    (state) => state.sleepTimer.configuredDurationMs,
  );
  const remainingMs = useAppStore((state) =>
    state.settingsModalOpen ? state.sleepTimer.remainingMs : 0,
  );
  const [pendingValue, setPendingValue] = useState("off");
  const appliedRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      const applied = resolveConfiguredDuration(
        useAppStore.getState().sleepTimer.configuredDurationMs,
      );
      appliedRef.current = applied;
      setPendingValue(valueForDuration(applied));
    }
  }, [open]);

  useEffect(() => {
    const applied = resolveConfiguredDuration(configuredDurationMs);
    if (applied !== appliedRef.current) {
      appliedRef.current = applied;
      setPendingValue(valueForDuration(applied));
    }
  }, [configuredDurationMs]);

  const close = () => useAppStore.setState({ settingsModalOpen: false });
  const countdown =
    remainingMs > 0
      ? t("sleepTimer.currentCountdown", {
          time: formatDuration(Math.ceil(Math.max(0, remainingMs) / 1000)),
        })
      : t("sleepTimer.off");

  const selectTheme = (nextTheme: ThemeName) => {
    setTheme(nextTheme);
  };

  const languageCredit = t("translationByNameCredit");

  return (
    <Modal
      id="settings-modal"
      open={open}
      onClose={close}
      panelClassName="settings-panel"
    >
      <div className="modal-header">
        <h2>{t("settings.title")}</h2>
        <button
          type="button"
          id="settings-close"
          className="modal-close"
          aria-label={t("common.close")}
          title={t("common.close")}
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
      <div className="modal-body settings-body">
        <section className="settings-section">
          <label className="settings-field" htmlFor="settings-language">
            <span className="label-line">{t("settings.language")}</span>
            <span className="viz-select-wrap settings-select-wrap">
              <select
                id="settings-language"
                className="viz-select settings-select"
                aria-label={t("settings.language")}
                value={resolveSupportedLanguage(i18n.resolvedLanguage)}
                onChange={(event) => {
                  void i18n.changeLanguage(event.target.value);
                }}
              >
                {supportedLanguageOptions.map((option) => (
                  <option key={option.code} value={option.code}>
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
            {languageCredit ? (
              <span className="hint">{languageCredit}</span>
            ) : null}
          </label>
        </section>

        <section className="settings-section">
          <fieldset className="settings-fieldset">
            <legend className="label-line">{t("settings.theme")}</legend>
            <div className="settings-theme-options">
              {(["light", "dark"] as const).map((option) => (
                <label key={option} className="settings-theme-option">
                  <input
                    type="radio"
                    name="settings-theme"
                    value={option}
                    checked={theme === option}
                    onChange={() => selectTheme(option)}
                  />
                  <span>{t(`common.${option}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="settings-section">
          <div className="label-line">{t("settings.sleepTimer")}</div>
          <div id="sleep-timer-current" className="sleep-timer-current">
            {countdown}
          </div>
          <div className="settings-field">
            <label className="label-line" htmlFor="sleep-timer-select">
              {t("sleepTimer.timer")}
            </label>
            <div className="settings-timer-row">
              <span className="viz-select-wrap settings-select-wrap">
                <select
                  id="sleep-timer-select"
                  className="viz-select settings-select"
                  value={pendingValue}
                  onChange={(event) => setPendingValue(event.target.value)}
                >
                  {SLEEP_TIMER_OPTIONS.map((option) => (
                    <option
                      key={valueForDuration(option.durationMs)}
                      value={valueForDuration(option.durationMs)}
                    >
                      {sleepTimerLabel(option.durationMs, t)}
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
              <button
                id="sleep-timer-set"
                type="button"
                className="settings-timer-set"
                onClick={() => {
                  setSleepTimer(durationFromValue(pendingValue));
                  close();
                }}
              >
                {t("common.set")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
