import { useEffect, useState } from "react";
import type { JukeboxAudioMode } from "@forever-jukebox/engine/audio/BufferedAudioPlayer";
import {
  applyExtrasChanges,
  applyTuningChanges,
  getExtrasFormValues,
  getTuningFormValues,
  resetExtrasDefaults,
  resetTuningDefaults,
  type ExtrasFormValues,
  type TuningFormValues,
} from "../../playback";
import { syncExtrasPopup } from "../../playback-ui";
import { getAppContext } from "../../runtime";
import { useAppStore } from "../../store";
import { Modal } from "../Modal";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const AUDIO_MODE_OPTIONS: Array<{
  id: string;
  value: JukeboxAudioMode;
  labelKey:
    | "common.off"
    | "audioModes.nightcore"
    | "audioModes.daycore"
    | "audioModes.vaporwave"
    | "audioModes.eightD"
    | "audioModes.lofi"
    | "audioModes.eightBit"
    | "audioModes.underwater"
    | "audioModes.cathedral"
    | "audioModes.cowbell"
    | "audioModes.swing";
  section: "default" | "styles" | "toys";
}> = [
  { id: "audio-mode-off", value: "off", labelKey: "common.off", section: "default" },
  { id: "audio-mode-nightcore", value: "nightcore", labelKey: "audioModes.nightcore", section: "styles" },
  { id: "audio-mode-daycore", value: "daycore", labelKey: "audioModes.daycore", section: "styles" },
  { id: "audio-mode-vaporwave", value: "vaporwave", labelKey: "audioModes.vaporwave", section: "styles" },
  { id: "audio-mode-eight-d", value: "eight_d", labelKey: "audioModes.eightD", section: "styles" },
  { id: "audio-mode-lofi", value: "lofi", labelKey: "audioModes.lofi", section: "styles" },
  { id: "audio-mode-eight-bit", value: "eight_bit", labelKey: "audioModes.eightBit", section: "styles" },
  { id: "audio-mode-underwater", value: "underwater", labelKey: "audioModes.underwater", section: "styles" },
  { id: "audio-mode-cathedral", value: "cathedral", labelKey: "audioModes.cathedral", section: "styles" },
  { id: "audio-mode-cowbell", value: "cowbell", labelKey: "audioModes.cowbell", section: "toys" },
  {
    id: "audio-mode-swing",
    value: "swing",
    labelKey: "audioModes.swing",
    section: "toys",
  },
];

const MIN_JUMP_DISTANCE_OPTIONS = [0, 5, 10, 20, 30] as const;

function formatMinJumpDistance(percent: number, t: TFunction) {
  return percent === 0
    ? t("tuning.anyDistance")
    : t("tuning.percentOfTrack", { percent });
}

function RangeRow({
  id,
  label,
  valueText,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  hint?: React.ReactNode;
}) {
  return (
    <label>
      <div className="label-line">
        {label} <span id={`${id}-val`}>{valueText}</span>
      </div>
      {hint}
      <input
        id={id}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function TuningModal() {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.tuningModalOpen);
  const storedTab = useAppStore((s) => s.tuningModalTab);
  const playMode = useAppStore((s) => s.playMode);
  const hasExtrasTab = playMode === "jukebox";
  const tab = hasExtrasTab ? storedTab : "tuning";
  const tuningActive = tab === "tuning";
  const [form, setForm] = useState<TuningFormValues | null>(null);
  const [extras, setExtras] = useState<ExtrasFormValues | null>(null);

  // Snapshot engine config + extras state when the modal opens (the read
  // half of the old syncTuningUI/syncExtrasUI).
  useEffect(() => {
    if (open) {
      setForm(getTuningFormValues(getAppContext()));
      setExtras(getExtrasFormValues());
    }
  }, [open]);

  const close = () => useAppStore.setState({ tuningModalOpen: false });

  const handleToggleTab = () => {
    useAppStore.setState({
      tuningModalTab: tab === "tuning" ? "extras" : "tuning",
    });
  };

  const handleApply = () => {
    if (tab === "extras") {
      if (!extras) {
        return;
      }
      const result = applyExtrasChanges(getAppContext(), extras);
      if (result.branchStatsChanged) {
        syncExtrasPopup(useAppStore.getState().selectedEdge);
      }
      close();
      return;
    }
    if (!form) {
      return;
    }
    setForm(applyTuningChanges(getAppContext(), form));
  };

  const handleReset = () => {
    if (tab === "extras") {
      resetExtrasDefaults(getAppContext());
      close();
      return;
    }
    resetTuningDefaults(getAppContext());
    close();
  };

  const setFormField = <K extends keyof TuningFormValues>(
    key: K,
    value: TuningFormValues[K],
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };
  const setExtrasField = <K extends keyof ExtrasFormValues>(
    key: K,
    value: ExtrasFormValues[K],
  ) => {
    setExtras((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const audioModeOption = (option: (typeof AUDIO_MODE_OPTIONS)[number]) => (
    <label
      key={option.id}
      className={
        option.section === "default"
          ? "audio-mode-option audio-mode-default-option"
          : "audio-mode-option"
      }
    >
      <input
        id={option.id}
        type="radio"
        name="audio-mode"
        value={option.value}
        checked={extras?.audioMode === option.value}
        disabled={!hasExtrasTab}
        onChange={() => setExtrasField("audioMode", option.value)}
      />
      {t(option.labelKey)}
    </label>
  );

  return (
    <>
      <Modal id="tuning-modal" open={open} onClose={close}>
        <div className="modal-header">
          <div className="modal-header-main">
            <h2
              id="tuning-title"
              className={tuningActive ? undefined : "is-extras-active"}
            >
              <span id="tuning-title-text">
                {tuningActive ? t("tuning.title") : t("tuning.extras")}
              </span>
            </h2>
            <div className="modal-tabs" aria-label={t("tuning.sections")}>
              <button
                id="tuning-tab-toggle"
                className={hasExtrasTab ? "modal-tab" : "modal-tab hidden"}
                type="button"
                aria-label={
                  tuningActive
                    ? t("tuning.switchToExtras")
                    : t("tuning.switchToTuning")
                }
                onClick={handleToggleTab}
              >
                <span
                  id="tuning-tab-toggle-icon"
                  className="material-symbols-outlined modal-tab-icon"
                  aria-hidden="true"
                >
                  {tuningActive ? "science" : "tune"}
                </span>
                <span id="tuning-tab-toggle-label">
                  {tuningActive ? t("tuning.extras") : t("tuning.title")}
                </span>
              </button>
            </div>
          </div>
          <div className="modal-header-actions">
            <button
              id="tuning-close"
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
        <div className="modal-body">
          <div id="tuning-panel-tuning" className={tuningActive ? undefined : "hidden"}>
            <RangeRow
              id="threshold"
              label={t("tuning.similarityThreshold")}
              valueText={`${form?.threshold ?? 2}`}
              min={2}
              max={80}
              step={1}
              value={form?.threshold ?? 2}
              onChange={(value) => setFormField("threshold", value)}
              hint={
                <div className="hint">
                  {t("tuning.computedThreshold")}{" "}
                  <span id="computed-threshold">
                    {form?.computedThreshold === null ||
                    form?.computedThreshold === undefined
                      ? "-"
                      : `${form.computedThreshold}`}
                  </span>
                </div>
              }
            />
            <RangeRow
              id="min-jump-distance"
              label={t("tuning.minJumpDistance")}
              valueText={formatMinJumpDistance(
                form?.minLongBranchPercent ?? 0,
                t,
              )}
              min={0}
              max={MIN_JUMP_DISTANCE_OPTIONS.length - 1}
              step={1}
              value={Math.max(
                0,
                MIN_JUMP_DISTANCE_OPTIONS.indexOf(
                  (form?.minLongBranchPercent ??
                    0) as (typeof MIN_JUMP_DISTANCE_OPTIONS)[number],
                ),
              )}
              onChange={(index) =>
                setFormField(
                  "minLongBranchPercent",
                  MIN_JUMP_DISTANCE_OPTIONS[index] ?? 0,
                )
              }
              hint={
                <div className="hint">
                  {t("tuning.minJumpDistanceHint")}
                </div>
              }
            />
            <RangeRow
              id="min-prob"
              label={t("tuning.probabilityMin")}
              valueText={`${form?.minProbPct ?? 18}%`}
              min={0}
              max={100}
              step={2}
              value={form?.minProbPct ?? 18}
              onChange={(value) => setFormField("minProbPct", value)}
            />
            <RangeRow
              id="max-prob"
              label={t("tuning.probabilityMax")}
              valueText={`${form?.maxProbPct ?? 50}%`}
              min={0}
              max={100}
              step={2}
              value={form?.maxProbPct ?? 50}
              onChange={(value) => setFormField("maxProbPct", value)}
            />
            <RangeRow
              id="ramp"
              label={t("tuning.rampSpeed")}
              valueText={`${form?.rampPct ?? 10}%`}
              min={0}
              max={100}
              step={2}
              value={form?.rampPct ?? 10}
              onChange={(value) => setFormField("rampPct", value)}
            />
            <div className="checkbox-row">
              <label>
                <input
                  id="just-backwards"
                  type="checkbox"
                  checked={form?.justBackwards ?? false}
                  onChange={(event) =>
                    setFormField("justBackwards", event.target.checked)
                  }
                />{" "}
                {t("tuning.onlyReverse")}
              </label>
              <label>
                <input
                  id="remove-seq"
                  type="checkbox"
                  checked={form?.removeSequentialBranches ?? false}
                  onChange={(event) =>
                    setFormField("removeSequentialBranches", event.target.checked)
                  }
                />{" "}
                {t("tuning.removeSequential")}
              </label>
              <label>
                <input
                  id="highlight-anchor-branch"
                  type="checkbox"
                  checked={form?.highlightAnchorBranch ?? false}
                  onChange={(event) =>
                    setFormField("highlightAnchorBranch", event.target.checked)
                  }
                />{" "}
                {t("tuning.highlightAnchor")}
              </label>
            </div>
          </div>
          <div
            id="tuning-panel-extras"
            className={tuningActive ? "hidden" : undefined}
          >
            <div className="checkbox-row extras-checkbox-row">
              <label>
                <input
                  id="extras-enabled"
                  type="checkbox"
                  checked={extras?.branchStatsEnabled ?? false}
                  disabled={!hasExtrasTab}
                  onChange={(event) =>
                    setExtrasField("branchStatsEnabled", event.target.checked)
                  }
                />{" "}
                {t("tuning.showBranchStats")}
              </label>
              <label>
                <input
                  id="bring-home-enabled"
                  type="checkbox"
                  checked={extras?.bringItHomeMode ?? false}
                  disabled={!hasExtrasTab}
                  onChange={(event) =>
                    setExtrasField("bringItHomeMode", event.target.checked)
                  }
                />{" "}
                {t("tuning.bringItHome")}
              </label>
            </div>
            <div id="jukebox-audio-mode-group" className="audio-mode-group">
              <div className="label-line">{t("tuning.audioMode")}</div>
              <div
                className="audio-mode-options"
                role="radiogroup"
                aria-label={t("tuning.audioMode")}
              >
                {audioModeOption(AUDIO_MODE_OPTIONS[0])}
                <div className="audio-mode-section">
                  <div className="audio-mode-section-title">{t("tuning.playbackStyles")}</div>
                  <div className="audio-mode-section-options">
                    {AUDIO_MODE_OPTIONS.filter(
                      (option) => option.section === "styles",
                    ).map(audioModeOption)}
                  </div>
                </div>
                <div className="audio-mode-section">
                  <div className="audio-mode-section-title">{t("tuning.remixToys")}</div>
                  <div className="audio-mode-section-options">
                    {AUDIO_MODE_OPTIONS.filter(
                      (option) => option.section === "toys",
                    ).map(audioModeOption)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer tuning-footer">
          <button id="tuning-reset" onClick={handleReset}>
            {t("common.reset")}
          </button>
          <button id="tuning-apply" onClick={handleApply}>
            {t("common.apply")}
          </button>
        </div>
      </Modal>
    </>
  );
}
