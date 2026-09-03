import type React from "react";
import { useTranslation } from "react-i18next";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { AudioModeOptions } from "./AudioModeOptions";
import {
  MIN_JUMP_DISTANCE_OPTIONS,
  formatMinJumpDistance,
  type ExtrasFormState,
  type TuneFormState,
} from "./tuning";
import type { PlayMode, TuningModalTab } from "./types";

export function TuningModal({
  playMode,
  activeTab,
  onTabChange,
  tuneForm,
  setTuneForm,
  extrasForm,
  setExtrasForm,
  onClose,
  onReset,
  onApply,
}: {
  playMode: PlayMode;
  activeTab: TuningModalTab;
  onTabChange: (tab: TuningModalTab) => void;
  tuneForm: TuneFormState;
  setTuneForm: React.Dispatch<React.SetStateAction<TuneFormState>>;
  extrasForm: ExtrasFormState;
  setExtrasForm: React.Dispatch<React.SetStateAction<ExtrasFormState>>;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal open">
      <button
        className="modal-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t("listen.closeTuningDialog")}
      />
      <div className="modal-panel">
        <div className="modal-header">
          <div className="modal-header-main">
            <h2
              id="tuning-title"
              className={activeTab === "extras" ? "is-extras-active" : ""}
            >
              <span id="tuning-title-text">
                {activeTab === "tuning"
                  ? t("tuning.title")
                  : t("tuning.extras")}
              </span>
            </h2>
            <div className="modal-tabs" aria-label={t("tuning.sections")}>
              <button
                id="tuning-tab-toggle"
                className={`modal-tab ${playMode !== "jukebox" ? "hidden" : ""}`}
                type="button"
                onClick={() =>
                  onTabChange(activeTab === "tuning" ? "extras" : "tuning")
                }
                aria-label={
                  activeTab === "tuning"
                    ? t("tuning.switchToExtras")
                    : t("tuning.switchToTuning")
                }
              >
                <SymbolIcon
                  className="modal-tab-icon"
                  name={activeTab === "tuning" ? "science" : "tune"}
                />
                <span id="tuning-tab-toggle-label">
                  {activeTab === "tuning"
                    ? t("tuning.extras")
                    : t("tuning.title")}
                </span>
              </button>
            </div>
          </div>
          <div className="modal-header-actions">
            <button className="modal-close" type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
              <SymbolIcon className="modal-close-icon" name="close" />
            </button>
          </div>
        </div>
        <div className="modal-body">
          <div id="tuning-panel-tuning" className={activeTab === "tuning" ? "" : "hidden"}>
            <label>
              <div className="label-line">
                <span>{t("tuning.similarityThreshold")}</span>
                <span>{tuneForm.threshold}</span>
              </div>
              <div className="hint">
                <span>{t("tuning.computedThreshold")}</span>
                <span>{tuneForm.computedThreshold}</span>
              </div>
              <input
                type="range"
                aria-label={t("tuning.similarityThreshold")}
                min={2}
                max={80}
                step={1}
                value={tuneForm.threshold}
                onChange={(event) =>
                  setTuneForm((prev) => ({ ...prev, threshold: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <div className="label-line">
                <span>{t("tuning.probabilityMin")}</span>
                <span>{tuneForm.minProb}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={2}
                value={tuneForm.minProb}
                aria-label={t("tuning.probabilityMin")}
                onChange={(event) =>
                  setTuneForm((prev) => ({ ...prev, minProb: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <div className="label-line">
                <span>{t("tuning.probabilityMax")}</span>
                <span>{tuneForm.maxProb}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={2}
                value={tuneForm.maxProb}
                aria-label={t("tuning.probabilityMax")}
                onChange={(event) =>
                  setTuneForm((prev) => ({ ...prev, maxProb: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <div className="label-line">
                <span>{t("tuning.rampSpeed")}</span>
                <span>{tuneForm.ramp}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={2}
                value={tuneForm.ramp}
                aria-label={t("tuning.rampSpeed")}
                onChange={(event) =>
                  setTuneForm((prev) => ({ ...prev, ramp: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <div className="label-line">
                <span>{t("tuning.minJumpDistance")}</span>
                <span>
                  {formatMinJumpDistance(tuneForm.minLongBranchPercent, t)}
                </span>
              </div>
              <div className="hint">
                {t("tuning.minJumpDistanceHint")}
              </div>
              <input
                id="min-jump-distance"
                type="range"
                min={0}
                max={MIN_JUMP_DISTANCE_OPTIONS.length - 1}
                step={1}
                value={Math.max(
                  0,
                  MIN_JUMP_DISTANCE_OPTIONS.indexOf(
                    tuneForm.minLongBranchPercent as (typeof MIN_JUMP_DISTANCE_OPTIONS)[number],
                  ),
                )}
                aria-label={t("tuning.minJumpDistance")}
                onChange={(event) =>
                  setTuneForm((prev) => ({
                    ...prev,
                    minLongBranchPercent:
                      MIN_JUMP_DISTANCE_OPTIONS[
                        Number(event.target.value)
                      ] ?? 0,
                  }))
                }
              />
            </label>
            <div className="checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={tuneForm.justBackwards}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, justBackwards: event.target.checked }))
                  }
                />
                <span>{t("tuning.onlyReverse")}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={tuneForm.removeSequentialBranches}
                  onChange={(event) =>
                    setTuneForm((prev) => ({ ...prev, removeSequentialBranches: event.target.checked }))
                  }
                />
                <span>{t("tuning.removeSequential")}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={tuneForm.highlightAnchorBranch}
                  onChange={(event) =>
                    setTuneForm((prev) => ({
                      ...prev,
                      highlightAnchorBranch: event.target.checked,
                    }))
                  }
                />
                <span>{t("tuning.highlightAnchor")}</span>
              </label>
            </div>
          </div>
          <div id="tuning-panel-extras" className={activeTab === "extras" ? "" : "hidden"}>
            <div className="checkbox-row extras-checkbox-row">
              <label>
                <input
                  id="extras-enabled"
                  type="checkbox"
                  checked={extrasForm.branchStatsEnabled}
                  onChange={(event) =>
                    setExtrasForm((prev) => ({
                      ...prev,
                      branchStatsEnabled: event.target.checked,
                    }))
                  }
                  disabled={playMode !== "jukebox"}
                />
                <span>{t("tuning.showBranchStats")}</span>
              </label>
              <label>
                <input
                  id="bring-home-enabled"
                  type="checkbox"
                  checked={extrasForm.bringItHomeMode}
                  onChange={(event) =>
                    setExtrasForm((prev) => ({
                      ...prev,
                      bringItHomeMode: event.target.checked,
                    }))
                  }
                  disabled={playMode !== "jukebox"}
                />
                <span>{t("tuning.bringItHome")}</span>
              </label>
            </div>
            <div id="jukebox-audio-mode-group" className="audio-mode-group">
              <div className="label-line">{t("tuning.audioMode")}</div>
              <AudioModeOptions
                selectedAudioMode={extrasForm.audioMode}
                disabled={playMode !== "jukebox"}
                onChange={(audioMode) =>
                  setExtrasForm((prev) => ({ ...prev, audioMode }))
                }
                intensityPct={extrasForm.audioIntensity}
                onIntensityChange={(audioIntensity) =>
                  setExtrasForm((prev) => ({ ...prev, audioIntensity }))
                }
              />
            </div>
          </div>
        </div>
        <div className="modal-footer tuning-footer">
          <button className="tab-btn" type="button" onClick={onReset}>{t("common.reset")}</button>
          <button className="tab-btn" type="button" onClick={onApply}>{t("common.apply")}</button>
        </div>
      </div>
    </div>
  );
}
