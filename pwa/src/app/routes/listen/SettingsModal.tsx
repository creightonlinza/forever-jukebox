import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  clearAllAnalysisCache,
  getAnalysisCacheBytes,
} from "@/core/infrastructure/cache/analysisCache";
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

function formatMegabytes(bytes: number) {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

function ClearCacheButton() {
  const { t } = useTranslation();
  const [usageBytes, setUsageBytes] = useState(0);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  const refreshUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    try {
      const bytes = await getAnalysisCacheBytes();
      setUsageBytes(bytes);
    } catch (err) {
      console.warn(`Failed to load cache usage: ${String(err)}`);
      setUsageBytes(0);
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  // The modal mounts fresh each time it opens, so a mount-time refresh
  // always reflects the current cache size.
  useEffect(() => {
    refreshUsage().catch((err) => {
      console.warn(`Failed to refresh cache usage: ${String(err)}`);
    });
  }, [refreshUsage]);

  const onClearCache = useCallback(async () => {
    setIsClearing(true);
    setCacheMessage(null);
    try {
      await clearAllAnalysisCache();
      await refreshUsage();
    } catch (err) {
      console.warn(`Failed to clear analysis cache: ${String(err)}`);
      setCacheMessage(t("settings.clearFailed"));
    } finally {
      setIsClearing(false);
    }
  }, [refreshUsage, t]);

  return (
    <>
      <button
        id="cached-analysis-clear"
        className="tab-btn settings-timer-set"
        type="button"
        disabled={isClearing || isLoadingUsage || usageBytes <= 0}
        onClick={onClearCache}
      >
        {isClearing
          ? t("settings.clearing")
          : t("settings.clearSize", { size: formatMegabytes(usageBytes) })}
      </button>
      {cacheMessage ? <p className="hint">{cacheMessage}</p> : null}
    </>
  );
}

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

          <section className="settings-section">
            <div className="label-line">{t("settings.cachedAnalysis")}</div>
            <ClearCacheButton />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
