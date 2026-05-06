export type JukeboxAudioMode =
  | "off"
  | "nightcore"
  | "daycore"
  | "vaporwave"
  | "eight_d"
  | "lofi"
  | "cowbell"
  | "swing";

export type AudioModeSettings = {
  rate: number;
  highPassFrequency: number | null;
  lowPassFrequency: number | null;
  useBandPass: boolean;
  reverbMix: number;
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
  lofi: {
    rate: 1,
    highPassFrequency: null,
    lowPassFrequency: 2000,
    useBandPass: true,
    reverbMix: 0.1,
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
