import { createFft, createHannWindow } from "./fft";

export const MDX_SAMPLE_RATE = 44_100;
export const MODEL_BINS = 3072;
export const MODEL_FRAMES = 256;
export const MODEL_INPUT_SHAPE = [1, 4, MODEL_BINS, MODEL_FRAMES] as const;
export const MODEL_INPUT_LENGTH = 4 * MODEL_BINS * MODEL_FRAMES;

const FFT_SIZE = 6144;
const HOP_SIZE = 1024;
// Sum of squared periodic Hann windows at a hop of FFT_SIZE / 6.
const OVERLAP_GAIN = 2.25;
const CHUNK_SAMPLES = HOP_SIZE * (MODEL_FRAMES - 1);
// Each chunk's outer edges are discarded; chunks advance by the kept middle.
const TRIM_SAMPLES = FFT_SIZE / 2;
export const STEP_SAMPLES = CHUNK_SAMPLES - 2 * TRIM_SAMPLES;
const FRAMED_SAMPLES = CHUNK_SAMPLES + FFT_SIZE;
const PLANE = MODEL_BINS * MODEL_FRAMES;

const FFT = createFft(FFT_SIZE);
const HANN_WINDOW = createHannWindow(FFT_SIZE);

// Receives one chunk's stereo spectrogram laid out
// [left real, left imag, right real, right imag][bin][frame] and returns the
// instrumental's spectrogram in the same layout.
export type RunMdxModel = (input: Float32Array) => Promise<Float32Array>;

export function countChunks(sampleCount: number): number {
  return Math.max(1, Math.ceil(sampleCount / STEP_SAMPLES));
}

// Copies one chunk with its centre-padding: silence outside the track and a
// reflection at each chunk edge.
function frameChunk(
  channel: Float32Array,
  sampleCount: number,
  chunkStart: number,
  framed: Float64Array,
) {
  for (let idx = 0; idx < FRAMED_SAMPLES; idx += 1) {
    let position = idx - FFT_SIZE / 2;
    if (position < 0) {
      position = -position;
    } else if (position >= CHUNK_SAMPLES) {
      position = 2 * (CHUNK_SAMPLES - 1) - position;
    }
    const source = chunkStart - TRIM_SAMPLES + position;
    framed[idx] = source >= 0 && source < sampleCount ? channel[source] : 0;
  }
}

export async function separateInstrumental(
  left: Float32Array,
  right: Float32Array,
  runModel: RunMdxModel,
  onProgress: (progress: number) => void,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const sampleCount = Math.min(left.length, right.length);
  const sources = [left, right];
  const outputs = sources.map(() => new Float32Array(sampleCount));
  const chunkCount = countChunks(sampleCount);

  const framed = new Float64Array(FRAMED_SAMPLES);
  const overlapped = new Float64Array(FRAMED_SAMPLES);
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);

  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const chunkStart = chunk * STEP_SAMPLES;
    const input = new Float32Array(MODEL_INPUT_LENGTH);
    for (let channel = 0; channel < sources.length; channel += 1) {
      frameChunk(sources[channel], sampleCount, chunkStart, framed);
      const realPlane = 2 * channel * PLANE;
      const imagPlane = realPlane + PLANE;
      for (let frame = 0; frame < MODEL_FRAMES; frame += 1) {
        const offset = frame * HOP_SIZE;
        for (let idx = 0; idx < FFT_SIZE; idx += 1) {
          real[idx] = framed[offset + idx] * HANN_WINDOW[idx];
          imag[idx] = 0;
        }
        FFT.transform(real, imag);
        for (let bin = 0; bin < MODEL_BINS; bin += 1) {
          input[realPlane + bin * MODEL_FRAMES + frame] = real[bin];
          input[imagPlane + bin * MODEL_FRAMES + frame] = imag[bin];
        }
      }
    }

    const estimate = await runModel(input);
    if (estimate.length !== MODEL_INPUT_LENGTH) {
      throw new Error("Separation model returned an unexpected output size");
    }

    for (let channel = 0; channel < sources.length; channel += 1) {
      overlapped.fill(0);
      const realPlane = 2 * channel * PLANE;
      const imagPlane = realPlane + PLANE;
      for (let frame = 0; frame < MODEL_FRAMES; frame += 1) {
        real.fill(0);
        imag.fill(0);
        for (let bin = 0; bin < MODEL_BINS; bin += 1) {
          real[bin] = estimate[realPlane + bin * MODEL_FRAMES + frame];
          imag[bin] = estimate[imagPlane + bin * MODEL_FRAMES + frame];
        }
        for (let bin = 1; bin < MODEL_BINS; bin += 1) {
          real[FFT_SIZE - bin] = real[bin];
          imag[FFT_SIZE - bin] = -imag[bin];
        }
        FFT.transform(real, imag, true);
        const offset = frame * HOP_SIZE;
        for (let idx = 0; idx < FFT_SIZE; idx += 1) {
          overlapped[offset + idx] +=
            (real[idx] / FFT_SIZE) * HANN_WINDOW[idx];
        }
      }
      const kept = Math.min(STEP_SAMPLES, sampleCount - chunkStart);
      const firstKept = FFT_SIZE / 2 + TRIM_SAMPLES;
      for (let idx = 0; idx < kept; idx += 1) {
        outputs[channel][chunkStart + idx] =
          overlapped[firstKept + idx] / OVERLAP_GAIN;
      }
    }
    onProgress((chunk + 1) / chunkCount);
  }

  return { left: outputs[0], right: outputs[1] };
}
