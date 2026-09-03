import type React from "react";
import { useTranslation } from "react-i18next";
import type { JukeboxExportProgress } from "@/shared/export";
import { formatDuration } from "@/shared/utils/format";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import {
  MAX_EXPORT_DURATION_SECONDS,
  exportProgressMessage,
  type AudioExportFormat,
  type ExportFormState,
} from "./exportAudio";

export function ExportModal({
  form,
  setForm,
  isExporting,
  progress,
  error,
  onClose,
  onExport,
}: {
  form: ExportFormState;
  setForm: React.Dispatch<React.SetStateAction<ExportFormState>>;
  isExporting: boolean;
  progress: JukeboxExportProgress | null;
  error: string | null;
  onClose: () => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal open">
      <button
        className="modal-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t("listen.closeExportDialog")}
        disabled={isExporting}
      />
      <div className="modal-panel">
        <div className="modal-header">
          <h2>{t("export.title")}</h2>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            disabled={isExporting}
          >
            <SymbolIcon className="modal-close-icon" name="close" />
          </button>
        </div>
        <div className="modal-body export-body">
          <p className="export-note">
            {t("export.note")}
          </p>
          <label>
            <div className="label-line">
              <span>{t("export.duration")}</span>
              <span>{formatDuration(form.durationSeconds)}</span>
            </div>
            <input
              className="field-input"
              type="number"
              aria-label={t("export.duration")}
              min={5}
              max={MAX_EXPORT_DURATION_SECONDS}
              step={5}
              value={form.durationSeconds}
              disabled={isExporting}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  durationSeconds: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            <div className="label-line">{t("export.format")}</div>
            <select
              className="field-input"
              value={form.format}
              disabled={isExporting}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  format: event.target.value as AudioExportFormat,
                }))
              }
            >
              <option value="mp3">{t("export.mp3")}</option>
              <option value="wav">{t("export.wav")}</option>
            </select>
          </label>
          {form.format === "mp3" ? (
            <label>
              <div className="label-line">
                <span>{t("export.bitrate")}</span>
                <span>{form.bitrateKbps} kbps</span>
              </div>
              <input
                type="range"
                aria-label={t("export.bitrate")}
                min={64}
                max={320}
                step={32}
                value={form.bitrateKbps}
                disabled={isExporting}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    bitrateKbps: Number(event.target.value),
                  }))
                }
              />
            </label>
          ) : null}
          {progress ? (
            <div className="export-status">
              {exportProgressMessage(progress.message, t)} (
              {Math.round(progress.percent)}%)
            </div>
          ) : null}
          {error ? <div className="error">{error}</div> : null}
        </div>
        <div className="modal-footer">
          <button
            className="tab-btn"
            type="button"
            onClick={onClose}
            disabled={isExporting}
          >
            {t("common.cancel")}
          </button>
          <button
            className="tab-btn"
            type="button"
            onClick={onExport}
            disabled={isExporting}
          >
            {isExporting ? t("export.exporting") : t("export.action")}
          </button>
        </div>
      </div>
    </div>
  );
}
