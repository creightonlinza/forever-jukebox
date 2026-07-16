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

export const MIN_AUDIO_MODE_INTENSITY = 50;
export const MAX_AUDIO_MODE_INTENSITY = 150;
export const DEFAULT_AUDIO_MODE_INTENSITY = 100;

export const INTENSITY_AUDIO_MODES: ReadonlySet<JukeboxAudioMode> = new Set([
  "nightcore",
  "daycore",
  "vaporwave",
]);

export function audioModeSupportsIntensity(mode: JukeboxAudioMode): boolean {
  return INTENSITY_AUDIO_MODES.has(mode);
}

export function clampAudioModeIntensity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUDIO_MODE_INTENSITY;
  }
  return Math.max(
    MIN_AUDIO_MODE_INTENSITY,
    Math.min(MAX_AUDIO_MODE_INTENSITY, Math.round(value)),
  );
}

export function scaleAudioModeSettings(
  settings: AudioModeSettings,
  intensityPct: number,
): AudioModeSettings {
  const clamped = clampAudioModeIntensity(intensityPct);
  if (clamped === DEFAULT_AUDIO_MODE_INTENSITY) {
    // Same reference guarantees 100% is bit-for-bit today's preset.
    return settings;
  }
  const i = clamped / 100;
  return {
    ...settings,
    rate: 1 + (settings.rate - 1) * i,
    reverbMix: Math.min(1, settings.reverbMix * i),
    highPassFrequency:
      settings.highPassFrequency === null
        ? null
        : settings.highPassFrequency * 2 ** (i - 1),
    lowPassFrequency:
      settings.lowPassFrequency === null
        ? null
        : settings.lowPassFrequency * 2 ** (1 - i),
  };
}

export function getAudioModeSettings(
  mode: JukeboxAudioMode,
  intensityPct: number = DEFAULT_AUDIO_MODE_INTENSITY,
): AudioModeSettings {
  const settings = AUDIO_MODE_SETTINGS[mode];
  if (!audioModeSupportsIntensity(mode)) {
    return settings;
  }
  return scaleAudioModeSettings(settings, intensityPct);
}

// Whether an audio-mode/intensity change is audible in the playback timing,
// i.e. the jukebox engine must resync its beat position to the player. A mode
// change always is; an intensity change only when the new mode scales with it.
export function audioModeChangeAffectsPlayback(
  previousMode: JukeboxAudioMode,
  nextMode: JukeboxAudioMode,
  previousIntensityPct: number,
  nextIntensityPct: number,
): boolean {
  return (
    previousMode !== nextMode ||
    (audioModeSupportsIntensity(nextMode) &&
      previousIntensityPct !== nextIntensityPct)
  );
}

// Audio-mode intensity travels as the integer-percent `ai` URL/wire parameter
// next to `am`. Absence means the default, and the value is only meaningful
// for modes that support intensity. Every app parses and writes it through
// these helpers so the contract can't drift.
export const AUDIO_MODE_INTENSITY_PARAM = "ai";

export function parseAudioModeIntensityParam(
  raw: string | null,
  mode: JukeboxAudioMode | null,
): number {
  if (raw === null || mode === null || !audioModeSupportsIntensity(mode)) {
    return DEFAULT_AUDIO_MODE_INTENSITY;
  }
  return clampAudioModeIntensity(Number.parseInt(raw, 10));
}

export function setAudioModeIntensityParam(
  params: URLSearchParams,
  mode: JukeboxAudioMode,
  intensityPct: number,
): void {
  if (
    audioModeSupportsIntensity(mode) &&
    intensityPct !== DEFAULT_AUDIO_MODE_INTENSITY
  ) {
    params.set(AUDIO_MODE_INTENSITY_PARAM, `${intensityPct}`);
  } else {
    params.delete(AUDIO_MODE_INTENSITY_PARAM);
  }
}

// Safety limiter shared by live playback and offline export: reverb modes sum
// dry (up to 1.0) plus wet (up to 0.9) gain, the nightcore/cathedral highpass
// adds resonance near its cutoff, and 8D panning sums channels — all of which
// can push peaks past 0dBFS. Threshold 0 with knee 0 leaves anything already
// under 0dBFS (notably the "off" mode) untouched, since the node's automatic
// makeup gain is exactly 1 at that threshold. Returns null when the context
// has no compressor support; callers fall back to a direct connection.
export function createSafetyLimiter(
  context: BaseAudioContext,
): DynamicsCompressorNode | null {
  if (typeof context.createDynamicsCompressor !== "function") {
    return null;
  }
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = 0;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.25;
  return limiter;
}

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
