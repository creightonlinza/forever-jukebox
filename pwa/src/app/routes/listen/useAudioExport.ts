import React from "react";
import type { TFunction } from "i18next";
import type { AnalysisOutput } from "@/shared/analysis-schema";
import {
  exportJukeboxAudio,
  type JukeboxExportProgress,
} from "@/shared/export";
import {
  pickBinaryExportFile,
  saveExportBinary,
} from "@/shared/utils/exportJson";
import type {
  BufferedAudioPlayer,
  JukeboxAudioMode,
} from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import { getOrCreateSwingBuffer } from "@forever-jukebox/shared/audio/swingBufferCache";
import { renderSwingBuffer } from "@forever-jukebox/shared/audio/swingRenderer";
import type { JukeboxEngine } from "@forever-jukebox/shared";
import { createSessionSeed, waitForNextPaint } from "./browser";
import {
  MAX_EXPORT_DURATION_SECONDS,
  buildAudioExportName,
  exportErrorMessage,
  type ExportFormState,
} from "./exportAudio";

// Export modal state and the render-to-file pipeline for the current track.
export function useAudioExport({
  file,
  analysis,
  analysisRef,
  playerRef,
  engineRef,
  jukeboxAudioMode,
  audioIntensity,
  getSwingSourceIdentity,
  t,
}: {
  file: File | null;
  analysis: AnalysisOutput | null;
  analysisRef: React.MutableRefObject<AnalysisOutput | null>;
  playerRef: React.MutableRefObject<BufferedAudioPlayer | null>;
  engineRef: React.MutableRefObject<JukeboxEngine | null>;
  jukeboxAudioMode: JukeboxAudioMode;
  audioIntensity: number;
  getSwingSourceIdentity: () => string | null;
  t: TFunction;
}) {
  const [isExportOpen, setIsExportOpen] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exportProgress, setExportProgress] =
    React.useState<JukeboxExportProgress | null>(null);
  const [exportForm, setExportForm] = React.useState<ExportFormState>({
    durationSeconds: 60,
    format: "mp3",
    bitrateKbps: 192,
  });

  React.useEffect(() => {
    const duration = analysis?.track?.duration;
    if (!duration || !Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const rounded = Math.max(5, Math.round(duration));
    setExportForm((prev) => ({
      ...prev,
      durationSeconds: Math.min(MAX_EXPORT_DURATION_SECONDS, rounded),
    }));
  }, [analysis]);

  const openExport = () => {
    setExportError(null);
    setExportProgress(null);
    setIsExportOpen(true);
  };

  const closeExport = () => {
    setIsExportOpen(false);
  };

  const resetExport = () => {
    setIsExportOpen(false);
    setIsExporting(false);
    setExportError(null);
    setExportProgress(null);
  };

  const onExportJukeboxAudio = async () => {
    const activeAnalysis = analysisRef.current ?? analysis;
    const player = playerRef.current;
    const engine = engineRef.current;
    if (!activeAnalysis || !player || !engine || !file) {
      return;
    }

    const sourceBuffer = player.getSourceBuffer() ?? player.getBuffer();
    if (!sourceBuffer) {
      setExportError(t("export.bufferUnavailable"));
      return;
    }

    const durationSeconds = Number(exportForm.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      setExportError(t("export.positiveDuration"));
      return;
    }
    if (durationSeconds > MAX_EXPORT_DURATION_SECONDS) {
      setExportError(t("export.durationCap", {
        minutes: MAX_EXPORT_DURATION_SECONDS / 60,
      }));
      return;
    }

    const requestedExtension = exportForm.format;
    const requestedFilename = buildAudioExportName(file.name, requestedExtension);
    const requestedDescription =
      requestedExtension === "mp3"
        ? t("export.mp3Description")
        : t("export.wavDescription");
    const requestedMimeType =
      requestedExtension === "mp3" ? "audio/mpeg" : "audio/wav";

    let pickedHandle: Awaited<ReturnType<typeof pickBinaryExportFile>> = null;
    try {
      pickedHandle = await pickBinaryExportFile(requestedFilename, {
        mimeType: requestedMimeType,
        description: requestedDescription,
        extension: `.${requestedExtension}`,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") {
        return;
      }
      console.warn(`Unable to open export save dialog: ${String(err)}`);
      setExportError(t("export.saveDialogFailed"));
      return;
    }

    setExportError(null);
    setExportProgress({
      stage: "planning",
      message: { kind: "initializing" },
      percent: 0,
    });
    setIsExporting(true);
    await waitForNextPaint();

    try {
      let swingBuffer: AudioBuffer | undefined;
      if (jukeboxAudioMode === "swing") {
        const existingSwingBuffer = player.getRenderedJukeboxAudioBuffer("swing");
        if (existingSwingBuffer) {
          swingBuffer = existingSwingBuffer;
        } else if (activeAnalysis.beats.length > 0) {
          setExportProgress({
            stage: "rendering",
            message: { kind: "preparingSwing" },
            percent: 2,
          });
          swingBuffer = await getOrCreateSwingBuffer(
            sourceBuffer,
            getSwingSourceIdentity(),
            () =>
              renderSwingBuffer(sourceBuffer, activeAnalysis.beats, {
                onProgress: (progress) => {
                  setExportProgress({
                    stage: "rendering",
                    message: { kind: "preparingSwing" },
                    percent: 2 + Math.max(0, Math.min(1, progress)) * 6,
                  });
                },
              }),
          );
          player.setRenderedJukeboxAudioBuffer("swing", swingBuffer);
        } else {
          throw new Error("Swing export requires beat analysis.");
        }
      }

      const deletedEdges =
        engine
          .getGraphState()
          ?.allEdges.filter((edge) => edge.deleted)
          .map((edge) => ({ src: edge.src.which, dest: edge.dest.which })) ?? [];
      const anchorEdge = engine.getUserAnchorEdge();

      const result = await exportJukeboxAudio({
        analysis: activeAnalysis,
        sourceBuffer,
        config: engine.getConfig(),
        deletedEdges,
        userAnchorEdge: anchorEdge
          ? { src: anchorEdge.src.which, dest: anchorEdge.dest.which }
          : null,
        durationSeconds,
        format: exportForm.format,
        bitrateKbps: exportForm.format === "mp3" ? exportForm.bitrateKbps : undefined,
        gain: player.getVolume(),
        audioMode: jukeboxAudioMode,
        audioIntensityPct: audioIntensity,
        sectionStartBeatIndices: engine.getSectionStartBeatIndices(),
        swingBuffer,
        randomMode: "seeded",
        seed: createSessionSeed(),
        onProgress: (progress) => setExportProgress(progress),
      });

      const extension = result.extension;
      const filename = buildAudioExportName(file.name, extension);
      const description =
        extension === "mp3"
          ? t("export.mp3Description")
          : t("export.wavDescription");
      await saveExportBinary(
        filename,
        result.bytes,
        {
          mimeType: result.mimeType,
          description,
          extension: `.${extension}`,
        },
        extension === requestedExtension ? pickedHandle : null,
      );
      setIsExportOpen(false);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") {
        return;
      }
      console.warn(`Audio export failed: ${String(err)}`);
      setExportError(exportErrorMessage(err, t));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJukeboxAudio = () => {
    onExportJukeboxAudio().catch((err) => {
      console.warn(`Audio export failed: ${String(err)}`);
      setExportError(exportErrorMessage(err, t));
      setIsExporting(false);
    });
  };

  return {
    isExportOpen,
    isExporting,
    exportError,
    exportProgress,
    exportForm,
    setExportForm,
    openExport,
    closeExport,
    resetExport,
    handleExportJukeboxAudio,
  };
}
