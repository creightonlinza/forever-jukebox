import type { TFunction } from "i18next";
import type { JukeboxExportProgress } from "@/shared/export";

export const MAX_EXPORT_DURATION_SECONDS = 60 * 60 * 2;
export type AudioExportFormat = "mp3" | "wav";

export type ExportFormState = {
  durationSeconds: number;
  format: AudioExportFormat;
  bitrateKbps: number;
};

export function buildAudioExportName(fileName: string, extension: string) {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return `${base || "jukebox"}_forever.${extension}`;
}

export function exportProgressMessage(
  message: JukeboxExportProgress["message"],
  t: TFunction,
) {
  switch (message.kind) {
    case "initializing":
      return t("export.initializing");
    case "preparingSwing":
      return t("listen.preparingSwing");
    case "planning":
      return t("export.planning");
    case "renderingChunk":
      return t("export.renderingChunk", message);
    case "encodingChunk":
      return t("export.encodingChunk", message);
    case "combiningChunks":
      return t("export.combiningChunks");
    case "renderingAudio":
      return t("export.renderingAudio");
    case "encodingFormat":
      return t("export.encodingFormat", message);
    case "finalizing":
      return t("export.finalizing");
  }
}

export function exportErrorMessage(error: unknown, t: TFunction) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message ===
    "WAV export is too large for browser memory at this duration. Use MP3 for long exports."
  ) {
    return t("export.wavTooLarge");
  }
  if (message === "Swing export requires beat analysis.") {
    return t("export.swingNeedsBeats");
  }
  return t("export.failed");
}
