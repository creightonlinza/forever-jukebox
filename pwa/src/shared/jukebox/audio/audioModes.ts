export type JukeboxAudioMode =
  | "off"
  | "nightcore"
  | "daycore"
  | "vaporwave"
  | "eight_d"
  | "eight_bit"
  | "lofi"
  | "underwater"
  | "cathedral"
  | "cowbell"
  | "swing";

export type AudioModeSettings = {
  rate: number;
  highPassFrequency: number | null;
  lowPassFrequency: number | null;
  useBandPass: boolean;
  crushBitDepth?: number;
  crushSampleRate?: number;
  dryMix?: number;
  reverbMix: number;
  reverbSeconds?: number;
  reverbDecay?: number;
  pan: boolean;
};

export const AUDIO_MODE_SETTINGS: Record<JukeboxAudioMode, AudioModeSettings> = {
  off: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: null,
    useBandPass: false,
    reverbMix: 0,
    pan: false,
  },
  nightcore: {
    rate: 1.2,
    highPassFrequency: 150,
    lowPassFrequency: null,
    useBandPass: false,
    reverbMix: 0,
    pan: false,
  },
  daycore: {
    rate: 0.8,
    highPassFrequency: null,
    lowPassFrequency: null,
    useBandPass: false,
    reverbMix: 0.4,
    pan: false,
  },
  vaporwave: {
    rate: 0.65,
    highPassFrequency: null,
    lowPassFrequency: 1000,
    useBandPass: false,
    reverbMix: 0.6,
    pan: false,
  },
  eight_d: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: null,
    useBandPass: false,
    reverbMix: 0.5,
    pan: true,
  },
  eight_bit: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: null,
    useBandPass: false,
    crushBitDepth: 8,
    crushSampleRate: 8000,
    reverbMix: 0,
    pan: false,
  },
  lofi: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: 2000,
    useBandPass: true,
    reverbMix: 0.1,
    pan: false,
  },
  underwater: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: 400,
    useBandPass: false,
    reverbMix: 0,
    pan: false,
  },
  cathedral: {
    rate: 1,
    highPassFrequency: 150,
    lowPassFrequency: 5500,
    useBandPass: false,
    dryMix: 0.7,
    reverbMix: 0.9,
    reverbSeconds: 4.75,
    reverbDecay: 2.5,
    pan: false,
  },
  cowbell: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: null,
    useBandPass: false,
    reverbMix: 0,
    pan: false,
  },
  swing: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: null,
    useBandPass: false,
    reverbMix: 0,
    pan: false,
  },
};

export const REVERB_SECONDS = 2.5;
export const PAN_STEP = 0.007;
const BITCRUSHER_CURVE_SAMPLES = 2048;

function quantizeSample(value: number, levels: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  const normalized = (clamped + 1) / 2;
  return (Math.round(normalized * (levels - 1)) / (levels - 1)) * 2 - 1;
}

export function createBitcrusherCurve(bitDepth: number): Float32Array<ArrayBuffer> {
  const levels = Math.max(2, Math.round(2 ** bitDepth));
  const curve = new Float32Array(
    BITCRUSHER_CURVE_SAMPLES,
  ) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = quantizeSample(input, levels);
  }
  return curve;
}

export function renderBitcrushedBuffer(
  context: BaseAudioContext,
  sourceBuffer: AudioBuffer,
  bitDepth: number,
  crushSampleRate: number,
): AudioBuffer {
  const output = context.createBuffer(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  );
  const levels = Math.max(2, Math.round(2 ** bitDepth));
  const holdFrames = Math.max(1, Math.round(sourceBuffer.sampleRate / crushSampleRate));

  for (let channelIndex = 0; channelIndex < sourceBuffer.numberOfChannels; channelIndex += 1) {
    const source = sourceBuffer.getChannelData(channelIndex);
    const target = output.getChannelData(channelIndex);
    for (let frame = 0; frame < source.length; frame += holdFrames) {
      const quantized = quantizeSample(source[frame] ?? 0, levels);
      const end = Math.min(source.length, frame + holdFrames);
      for (let heldFrame = frame; heldFrame < end; heldFrame += 1) {
        target[heldFrame] = quantized;
      }
    }
  }

  return output;
}
