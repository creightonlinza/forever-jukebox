import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?url";
import type { PreparedAnalysisAudio } from "@/core/domain/ports/AudioDecoderPort";

const SR_FEATURES = 22050;
const SR_BEATS = 44100;

type PreparedFfmpegAudio = PreparedAnalysisAudio & {
  playbackWav: Uint8Array;
};

export type EncodedAudioFormat = "mp3" | "wav";

export interface EncodeAudioBufferOptions {
  format: EncodedAudioFormat;
  bitrateKbps?: number;
  onProgress?: (progress: number) => void;
}

export interface EncodedAudioResult {
  bytes: Uint8Array;
  extension: EncodedAudioFormat;
  mimeType: string;
}

function concatByteArrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let ffmpegOperationQueue: Promise<void> = Promise.resolve();

async function getFfmpeg() {
  if (!ffmpegSingleton) {
    ffmpegSingleton = new FFmpeg();
  }
  if (ffmpegSingleton.loaded) {
    return ffmpegSingleton;
  }
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = ffmpegSingleton
      .load({
        coreURL,
        wasmURL,
        classWorkerURL,
      })
      .then(() => ffmpegSingleton as FFmpeg)
      .catch((error) => {
        ffmpegLoadPromise = null;
        throw error;
      });
  }
  return ffmpegLoadPromise;
}

function withFfmpegLock<T>(task: (ffmpeg: FFmpeg) => Promise<T>): Promise<T> {
  const run = ffmpegOperationQueue.then(async () => {
    const ffmpeg = await getFfmpeg();
    return task(ffmpeg);
  });
  ffmpegOperationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readBytes(data: Uint8Array | string, label: string) {
  if (typeof data === "string") {
    throw new Error(`Unexpected text output for ${label}`);
  }
  return data;
}

function bytesToFloat32(data: Uint8Array, label: string) {
  if (data.byteLength % 4 !== 0) {
    throw new Error(`Invalid float32 output for ${label}`);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Float32Array(copy.buffer);
}

function clampBitrateKbps(value: number | undefined): number {
  const fallback = 192;
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(64, Math.min(320, Math.round(value)));
}

function interleaveAudioBuffer(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const output = new Float32Array(length * channels);
  for (let sample = 0; sample < length; sample += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      output[sample * channels + channel] = buffer.getChannelData(channel)[sample];
    }
  }
  return output;
}

function float32ToBytes(data: Float32Array): Uint8Array {
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

async function deleteIfExists(ffmpeg: FFmpeg, path: string) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // no-op
  }
}

export async function prepareAudioWithFfmpeg(
  file: File,
): Promise<PreparedFfmpegAudio> {
  return withFfmpegLock(async (ffmpeg) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const inputName = `input-${id}`;
    const output22050 = `mono-22050-${id}.f32`;
    const output44100 = `mono-44100-${id}.f32`;
    const outputPlayback = `playback-${id}.wav`;
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const decode22050Code = await ffmpeg.exec([
        "-i",
        inputName,
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        String(SR_FEATURES),
        "-c:a",
        "pcm_f32le",
        "-f",
        "f32le",
        output22050,
      ]);
      if (decode22050Code !== 0) {
        throw new Error(`ffmpeg 22.05k decode exited with code ${decode22050Code}`);
      }

      const upsample44100Code = await ffmpeg.exec([
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        String(SR_FEATURES),
        "-i",
        output22050,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        String(SR_BEATS),
        "-c:a",
        "pcm_f32le",
        "-f",
        "f32le",
        output44100,
      ]);
      if (upsample44100Code !== 0) {
        throw new Error(`ffmpeg 44.1k upsample exited with code ${upsample44100Code}`);
      }

      const playbackCode = await ffmpeg.exec([
        "-i",
        inputName,
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "2",
        "-ar",
        String(SR_BEATS),
        "-c:a",
        "pcm_s16le",
        outputPlayback,
      ]);
      if (playbackCode !== 0) {
        throw new Error(`ffmpeg playback decode exited with code ${playbackCode}`);
      }

      const mono22050Bytes = readBytes(
        await ffmpeg.readFile(output22050),
        output22050,
      );
      const mono44100Bytes = readBytes(
        await ffmpeg.readFile(output44100),
        output44100,
      );
      const playbackWav = readBytes(
        await ffmpeg.readFile(outputPlayback),
        outputPlayback,
      );

      const mono22050 = bytesToFloat32(mono22050Bytes, output22050);
      const mono44100 = bytesToFloat32(mono44100Bytes, output44100);
      const duration = mono22050.length / SR_FEATURES;

      return {
        mono22050,
        mono44100,
        duration,
        playbackWav,
      };
    } finally {
      await deleteIfExists(ffmpeg, inputName);
      await deleteIfExists(ffmpeg, output22050);
      await deleteIfExists(ffmpeg, output44100);
      await deleteIfExists(ffmpeg, outputPlayback);
    }
  });
}

export async function encodeAudioBufferWithFfmpeg(
  buffer: AudioBuffer,
  options: EncodeAudioBufferOptions,
): Promise<EncodedAudioResult> {
  if (buffer.length === 0 || buffer.numberOfChannels === 0) {
    throw new Error("Cannot encode empty audio buffer.");
  }
  return withFfmpegLock(async (ffmpeg) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const inputName = `export-input-${id}.f32`;
    const outputName =
      options.format === "mp3" ? `export-output-${id}.mp3` : `export-output-${id}.wav`;
    const interleaved = interleaveAudioBuffer(buffer);
    const channels = Math.max(1, Math.min(8, buffer.numberOfChannels));
    const sampleRate = Math.max(8000, Math.round(buffer.sampleRate));
    const onProgress = options.onProgress;
    const progressHandler = (event: { progress: number }) => {
      if (!onProgress) {
        return;
      }
      onProgress(Math.max(0, Math.min(1, event.progress)));
    };

    try {
      if (onProgress) {
        ffmpeg.on("progress", progressHandler);
      }
      await ffmpeg.writeFile(inputName, float32ToBytes(interleaved));
      const args = [
        "-f",
        "f32le",
        "-ac",
        String(channels),
        "-ar",
        String(sampleRate),
        "-i",
        inputName,
      ];

      if (options.format === "mp3") {
        args.push(
          "-vn",
          "-map",
          "0:a:0",
          "-c:a",
          "libmp3lame",
          "-b:a",
          `${clampBitrateKbps(options.bitrateKbps)}k`,
          "-f",
          "mp3",
          outputName,
        );
      } else {
        args.push(
          "-vn",
          "-map",
          "0:a:0",
          "-c:a",
          "pcm_s16le",
          "-f",
          "wav",
          outputName,
        );
      }

      const code = await ffmpeg.exec(args);
      if (code !== 0) {
        throw new Error(`ffmpeg ${options.format} export exited with code ${code}`);
      }

      const bytes = readBytes(await ffmpeg.readFile(outputName), outputName);
      return {
        bytes,
        extension: options.format,
        mimeType: options.format === "mp3" ? "audio/mpeg" : "audio/wav",
      };
    } catch (error) {
      if (options.format === "mp3") {
        throw new Error(
          `MP3 export failed in ffmpeg (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
      throw error;
    } finally {
      if (onProgress) {
        ffmpeg.off("progress", progressHandler);
      }
      await deleteIfExists(ffmpeg, inputName);
      await deleteIfExists(ffmpeg, outputName);
    }
  });
}

export async function concatMp3ChunksWithFfmpeg(
  chunks: Uint8Array[],
): Promise<EncodedAudioResult> {
  if (chunks.length === 0) {
    throw new Error("No MP3 chunks to concatenate.");
  }
  if (chunks.length === 1) {
    return {
      bytes: chunks[0],
      extension: "mp3",
      mimeType: "audio/mpeg",
    };
  }

  return withFfmpegLock(async (ffmpeg) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const listName = `export-chunks-${id}.txt`;
    const outputName = `export-output-${id}.mp3`;
    const chunkNames: string[] = [];

    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkName = `chunk-${id}-${i}.mp3`;
        chunkNames.push(chunkName);
        await ffmpeg.writeFile(chunkName, chunks[i]);
      }

      const concatList = chunkNames.map((name) => `file '${name}'`).join("\n");
      await ffmpeg.writeFile(listName, concatList);

      const code = await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listName,
        "-c",
        "copy",
        outputName,
      ]);
      if (code !== 0) {
        throw new Error(`ffmpeg mp3 concat exited with code ${code}`);
      }

      const bytes = readBytes(await ffmpeg.readFile(outputName), outputName);
      return {
        bytes,
        extension: "mp3",
        mimeType: "audio/mpeg",
      };
    } catch {
      // Fallback: raw frame concatenation is widely playable even without ffmpeg concat.
      return {
        bytes: concatByteArrays(chunks),
        extension: "mp3",
        mimeType: "audio/mpeg",
      };
    } finally {
      await deleteIfExists(ffmpeg, listName);
      await deleteIfExists(ffmpeg, outputName);
      for (const chunkName of chunkNames) {
        await deleteIfExists(ffmpeg, chunkName);
      }
    }
  });
}
