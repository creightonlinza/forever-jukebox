import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  resolveSupportedLanguage,
  supportedLanguageOptions,
} from "@/app/i18n";
import type { ThemeName } from "@/app/theme";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import {
  SLEEP_TIMER_OPTIONS,
  formatSleepTimerRemaining,
  getSleepTimerDurationFromValue,
  getSleepTimerOptionValue,
  sleepTimerOptionLabel,
  type SleepTimerState,
} from "./sleepTimer";

export function SettingsModal({
  theme,
  onThemeChange,
  sleepTimer,
  pendingSleepTimerDurationMs,
  onPendingSleepTimerDurationChange,
  onSetSleepTimer,
  onClose,
}: {
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  sleepTimer: SleepTimerState;
  pendingSleepTimerDurationMs: number | null;
  onPendingSleepTimerDurationChange: (durationMs: number | null) => void;
  onSetSleepTimer: (durationMs: number | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const languageCredit = t("translationByNameCredit");
  return createPortal(
    <div
      id="settings-modal"
      className="modal open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <button
        className="modal-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
      />
      <div className="modal-panel settings-panel">
        <div className="modal-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button
            id="settings-close"
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <SymbolIcon className="modal-close-icon" name="close" />
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
                <SymbolIcon
                  className="viz-select-arrow"
                  name="arrow_drop_down"
                />
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
                      onChange={() => onThemeChange(option)}
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
              {sleepTimer.remainingMs > 0
                ? t("sleepTimer.currentCountdown", {
                    time: formatSleepTimerRemaining(sleepTimer.remainingMs),
                  })
                : t("sleepTimer.off")}
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
                    value={getSleepTimerOptionValue(
                      pendingSleepTimerDurationMs,
                    )}
                    onChange={(event) =>
                      onPendingSleepTimerDurationChange(
                        getSleepTimerDurationFromValue(event.target.value),
                      )
                    }
                  >
                    {SLEEP_TIMER_OPTIONS.map((option) => (
                      <option
                        key={getSleepTimerOptionValue(option.durationMs)}
                        value={getSleepTimerOptionValue(option.durationMs)}
                      >
                        {sleepTimerOptionLabel(option.durationMs, t)}
                      </option>
                    ))}
                  </select>
                  <SymbolIcon
                    className="viz-select-arrow"
                    name="arrow_drop_down"
                  />
                </span>
                <button
                  id="sleep-timer-set"
                  className="tab-btn settings-timer-set"
                  type="button"
                  onClick={() => {
                    onSetSleepTimer(pendingSleepTimerDurationMs);
                    onClose();
                  }}
                >
                  {t("common.set")}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
