import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { clearCachedAudio, getCachedAudioBytes } from "../cache";
import { formatDuration } from "../format";
import {
  resolveSupportedLanguage,
  supportedLanguageOptions,
} from "../i18n";
import { trackEvent } from "../analytics";
import { SLEEP_TIMER_OPTIONS, setSleepTimer } from "../playback";
import { useAppStore } from "../store";
import type { ThemeName } from "../themeConfig";
import { showToast } from "../ui";
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

function formatMegabytes(bytes: number) {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

function CachedAudioClearButton({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(() =>
    t("settings.clearSize", { size: 0 }),
  );
  const [disabled, setDisabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const bytes = await getCachedAudioBytes();
      setLabel(t("settings.clearSize", { size: formatMegabytes(bytes) }));
      setDisabled(bytes <= 0);
    } catch (err) {
      console.warn(`Cache size failed: ${String(err)}`);
      setLabel(t("settings.clearSize", { size: 0 }));
      setDisabled(true);
    }
  }, [t]);

  // The modal stays mounted while closed, so refresh each time it opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    refresh().catch((err) => {
      console.warn(`Cache size refresh failed: ${String(err)}`);
    });
  }, [open, refresh]);

  const handleClear = async () => {
    setDisabled(true);
    setLabel(t("settings.clearing"));
    try {
      await clearCachedAudio();
      showToast(t("settings.cachedCleared"));
    } catch (err) {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast(t("settings.cachedClearFailed"));
    } finally {
      refresh().catch((err) => {
        console.warn(`Cache size refresh failed: ${String(err)}`);
      });
    }
  };

  const handleClearClick = () => {
    handleClear().catch((err) => {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast(t("settings.cachedClearFailed"));
    });
  };

  return (
    <button
      id="cached-audio-clear"
      type="button"
      className="settings-timer-set"
      disabled={disabled}
      onClick={handleClearClick}
    >
      {label}
    </button>
  );
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      const applied = resolveConfiguredDuration(
        useAppStore.getState().sleepTimer.configuredDurationMs,
      );
      appliedRef.current = applied;
      setPendingValue(valueForDuration(applied));
      // Modal focuses the first focusable child, which is the bug button;
      // Close is the safer landing spot for an Enter press on open.
      closeRef.current?.focus();
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

  // The feedback modal records its focus-restore target as it opens, and the
  // bug button is hidden along with this modal in the same update; hand focus
  // to the settings gear so closing the feedback modal returns there.
  const openFeedback = () => {
    const gear = Array.from(
      document.querySelectorAll<HTMLElement>(".settings-button"),
    ).find((button) =>
      typeof button.checkVisibility === "function"
        ? button.checkVisibility()
        : true,
    );
    gear?.focus();
    useAppStore.setState({
      settingsModalOpen: false,
      feedbackModalOpen: true,
    });
  };
  const countdown =
    remainingMs > 0
      ? t("sleepTimer.currentCountdown", {
          time: formatDuration(Math.ceil(Math.max(0, remainingMs) / 1000)),
        })
      : t("sleepTimer.off");

  const selectTheme = (nextTheme: ThemeName) => {
    trackEvent("theme", { theme: nextTheme });
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
        <div className="modal-header-actions">
          <button
            type="button"
            id="settings-report-bug"
            className="modal-close settings-report-bug"
            aria-label={t("settings.reportBug")}
            title={t("settings.reportBug")}
            onClick={openFeedback}
          >
            <span
              className="material-symbols-outlined modal-close-icon"
              aria-hidden="true"
            >
              bug_report
            </span>
          </button>
          <button
            type="button"
            id="settings-close"
            ref={closeRef}
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
                  const durationMs = durationFromValue(pendingValue);
                  trackEvent("sleep_timer", {
                    duration_min:
                      durationMs === null
                        ? "off"
                        : String(Math.round(durationMs / 60000)),
                  });
                  setSleepTimer(durationMs);
                  close();
                }}
              >
                {t("common.set")}
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="label-line">{t("settings.cachedAudio")}</div>
          <CachedAudioClearButton open={open} />
        </section>
      </div>
    </Modal>
  );
}
