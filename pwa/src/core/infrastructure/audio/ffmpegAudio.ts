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

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

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
  const ffmpeg = await getFfmpeg();
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
}
