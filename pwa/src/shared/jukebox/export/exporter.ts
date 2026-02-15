import type { AnalysisOutput } from "@/shared/analysis-schema";
import {
  concatMp3ChunksWithFfmpeg,
  encodeAudioBufferWithFfmpeg,
  type EncodedAudioFormat,
} from "@/core/infrastructure/audio/ffmpegAudio";
import type { JukeboxConfig, RandomMode } from "@/shared/jukebox/engine";
import {
  planJukeboxPath,
  type DeletedEdgeRef,
  type PlannedJukeboxSegment,
} from "./plan";
import { renderJukeboxAudio } from "./render";

export interface JukeboxExportProgress {
  stage: "planning" | "rendering" | "encoding";
  message: string;
  percent: number;
}

export interface ExportJukeboxAudioOptions {
  analysis: AnalysisOutput;
  sourceBuffer: AudioBuffer;
  config: JukeboxConfig;
  deletedEdges?: DeletedEdgeRef[];
  durationSeconds: number;
  format: EncodedAudioFormat;
  bitrateKbps?: number;
  gain?: number;
  randomMode?: RandomMode;
  seed?: number;
  onProgress?: (progress: JukeboxExportProgress) => void;
}

export interface ExportJukeboxAudioResult {
  bytes: Uint8Array;
  extension: EncodedAudioFormat;
  mimeType: string;
  renderedDurationSeconds: number;
  beatsPlanned: number;
  segments: PlannedJukeboxSegment[];
}

const MP3_RENDER_CHUNK_SECONDS = 120;
const MAX_WAV_FLOAT32_RENDER_BYTES = 1_200_000_000;

function report(
  onProgress: ExportJukeboxAudioOptions["onProgress"],
  stage: JukeboxExportProgress["stage"],
  message: string,
  percent: number,
) {
  onProgress?.({
    stage,
    message,
    percent: Math.max(0, Math.min(100, percent)),
  });
}

export async function exportJukeboxAudio(
  options: ExportJukeboxAudioOptions,
): Promise<ExportJukeboxAudioResult> {
  report(options.onProgress, "planning", "Planning branch path", 2);

  const plan = planJukeboxPath({
    analysis: options.analysis,
    bufferDurationSeconds: options.sourceBuffer.duration,
    durationSeconds: options.durationSeconds,
    config: options.config,
    deletedEdges: options.deletedEdges,
    randomMode: options.randomMode,
    seed: options.seed,
  });

  let encoded;

  if (options.format === "mp3") {
    const totalDuration = Math.max(0.001, plan.renderDurationSeconds);
    const chunkCount = Math.max(1, Math.ceil(totalDuration / MP3_RENDER_CHUNK_SECONDS));
    const encodedChunks: Uint8Array[] = [];

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunkStart = chunkIndex * MP3_RENDER_CHUNK_SECONDS;
      const chunkDuration = Math.min(
        MP3_RENDER_CHUNK_SECONDS,
        totalDuration - chunkStart,
      );
      const chunkSegments = projectSegmentsIntoWindow(
        plan.segments,
        chunkStart,
        chunkDuration,
      );

      report(
        options.onProgress,
        "rendering",
        `Rendering chunk ${chunkIndex + 1}/${chunkCount}`,
        8 + (chunkIndex / chunkCount) * 72,
      );
      const renderedChunk = await renderJukeboxAudio({
        sourceBuffer: options.sourceBuffer,
        segments: chunkSegments,
        durationSeconds: chunkDuration,
        gain: options.gain ?? 1,
        onProgress: (progress) => {
          const completed = chunkIndex + progress;
          const percent = 8 + (completed / chunkCount) * 72;
          report(
            options.onProgress,
            "rendering",
            `Rendering chunk ${chunkIndex + 1}/${chunkCount}`,
            percent,
          );
        },
      });

      const encodeStart = 82 + (chunkIndex / chunkCount) * 16;
      const encodeSpan = 16 / chunkCount;
      report(
        options.onProgress,
        "encoding",
        `Encoding chunk ${chunkIndex + 1}/${chunkCount}`,
        encodeStart,
      );
      const chunkEncoded = await encodeAudioBufferWithFfmpeg(renderedChunk, {
        format: "mp3",
        bitrateKbps: options.bitrateKbps,
        onProgress: (progress) => {
          report(
            options.onProgress,
            "encoding",
            `Encoding chunk ${chunkIndex + 1}/${chunkCount}`,
            encodeStart + progress * encodeSpan,
          );
        },
      });
      encodedChunks.push(chunkEncoded.bytes);
    }

    report(options.onProgress, "encoding", "Combining encoded chunks", 98);
    encoded = await concatMp3ChunksWithFfmpeg(encodedChunks);
  } else {
    const estimatedBytes =
      plan.renderDurationSeconds *
      options.sourceBuffer.sampleRate *
      options.sourceBuffer.numberOfChannels *
      4;
    if (estimatedBytes > MAX_WAV_FLOAT32_RENDER_BYTES) {
      throw new Error(
        "WAV export is too large for browser memory at this duration. Use MP3 for long exports.",
      );
    }

    report(options.onProgress, "rendering", "Rendering offline audio", 8);

    const rendered = await renderJukeboxAudio({
      sourceBuffer: options.sourceBuffer,
      segments: plan.segments,
      durationSeconds: plan.renderDurationSeconds,
      gain: options.gain ?? 1,
      onProgress: (progress) => {
        const percent = 8 + progress * 72;
        report(options.onProgress, "rendering", "Rendering offline audio", percent);
      },
    });

    report(options.onProgress, "encoding", `Encoding ${options.format.toUpperCase()}`, 82);

    encoded = await encodeAudioBufferWithFfmpeg(rendered, {
      format: options.format,
      bitrateKbps: options.bitrateKbps,
      onProgress: (progress) => {
        const percent = 82 + progress * 18;
        report(
          options.onProgress,
          "encoding",
          `Encoding ${options.format.toUpperCase()}`,
          percent,
        );
      },
    });
  }

  report(options.onProgress, "encoding", "Finalizing file", 100);

  return {
    ...encoded,
    renderedDurationSeconds: plan.renderDurationSeconds,
    beatsPlanned: plan.segments.length,
    segments: plan.segments,
  };
}

function projectSegmentsIntoWindow(
  segments: PlannedJukeboxSegment[],
  windowStart: number,
  windowDuration: number,
): PlannedJukeboxSegment[] {
  const windowEnd = windowStart + windowDuration;
  const projected: PlannedJukeboxSegment[] = [];

  for (const segment of segments) {
    const segmentStart = segment.outputStart;
    const segmentEnd = segment.outputStart + segment.duration;
    if (segmentEnd <= windowStart || segmentStart >= windowEnd) {
      continue;
    }
    const clippedStart = Math.max(segmentStart, windowStart);
    const clippedEnd = Math.min(segmentEnd, windowEnd);
    const clippedDuration = clippedEnd - clippedStart;
    if (clippedDuration <= 0) {
      continue;
    }
    const sourceOffset = clippedStart - segmentStart;
    projected.push({
      ...segment,
      outputStart: clippedStart - windowStart,
      sourceStart: segment.sourceStart + sourceOffset,
      duration: clippedDuration,
    });
  }

  return projected;
}
