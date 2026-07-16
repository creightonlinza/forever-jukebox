import { describe, expect, it } from "vitest";
import {
  AUDIO_MODE_SETTINGS,
  DEFAULT_AUDIO_MODE_INTENSITY,
  INTENSITY_AUDIO_MODES,
  MAX_AUDIO_MODE_INTENSITY,
  MIN_AUDIO_MODE_INTENSITY,
  audioModeSupportsIntensity,
  clampAudioModeIntensity,
  getAudioModeSettings,
  scaleAudioModeSettings,
  type JukeboxAudioMode,
} from "./audioModes";

const ALL_MODES = Object.keys(AUDIO_MODE_SETTINGS) as JukeboxAudioMode[];

describe("clampAudioModeIntensity", () => {
  it("clamps to the supported range", () => {
    expect(clampAudioModeIntensity(49)).toBe(MIN_AUDIO_MODE_INTENSITY);
    expect(clampAudioModeIntensity(151)).toBe(MAX_AUDIO_MODE_INTENSITY);
    expect(clampAudioModeIntensity(50)).toBe(50);
    expect(clampAudioModeIntensity(150)).toBe(150);
  });

  it("rounds to integers", () => {
    expect(clampAudioModeIntensity(105.4)).toBe(105);
    expect(clampAudioModeIntensity(105.5)).toBe(106);
  });

  it("falls back to the default for non-finite values", () => {
    expect(clampAudioModeIntensity(Number.NaN)).toBe(
      DEFAULT_AUDIO_MODE_INTENSITY,
    );
    expect(clampAudioModeIntensity(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_AUDIO_MODE_INTENSITY,
    );
  });
});

describe("audioModeSupportsIntensity", () => {
  it("supports exactly nightcore, daycore, and vaporwave", () => {
    const supported = ALL_MODES.filter(audioModeSupportsIntensity);
    expect(new Set(supported)).toEqual(INTENSITY_AUDIO_MODES);
    expect(supported).toEqual(["nightcore", "daycore", "vaporwave"]);
  });
});

describe("scaleAudioModeSettings", () => {
  it("returns the same reference at 100% for every mode", () => {
    for (const mode of ALL_MODES) {
      const settings = AUDIO_MODE_SETTINGS[mode];
      expect(scaleAudioModeSettings(settings, 100)).toBe(settings);
    }
  });

  it("scales nightcore at the range endpoints", () => {
    const low = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.nightcore, 50);
    expect(low.rate).toBeCloseTo(1.1, 10);
    expect(low.highPassFrequency).toBeCloseTo(150 * 2 ** -0.5, 6);
    const high = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.nightcore, 150);
    expect(high.rate).toBeCloseTo(1.3, 10);
    expect(high.highPassFrequency).toBeCloseTo(150 * 2 ** 0.5, 6);
  });

  it("scales daycore at the range endpoints", () => {
    const low = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.daycore, 50);
    expect(low.rate).toBeCloseTo(0.9, 10);
    expect(low.reverbMix).toBeCloseTo(0.2, 10);
    const high = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.daycore, 150);
    expect(high.rate).toBeCloseTo(0.7, 10);
    expect(high.reverbMix).toBeCloseTo(0.6, 10);
  });

  it("scales vaporwave at the range endpoints", () => {
    const low = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.vaporwave, 50);
    expect(low.rate).toBeCloseTo(0.825, 10);
    expect(low.reverbMix).toBeCloseTo(0.3, 10);
    expect(low.lowPassFrequency).toBeCloseTo(1000 * 2 ** 0.5, 6);
    const high = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.vaporwave, 150);
    expect(high.rate).toBeCloseTo(0.475, 10);
    expect(high.reverbMix).toBeCloseTo(0.9, 10);
    expect(high.lowPassFrequency).toBeCloseTo(1000 * 2 ** -0.5, 6);
  });

  it("caps reverbMix at 1 and leaves null filters null", () => {
    const scaled = scaleAudioModeSettings(
      { ...AUDIO_MODE_SETTINGS.daycore, reverbMix: 0.8 },
      150,
    );
    expect(scaled.reverbMix).toBe(1);
    expect(scaled.lowPassFrequency).toBeNull();
    const nightcore = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.nightcore, 150);
    expect(nightcore.lowPassFrequency).toBeNull();
    expect(scaleAudioModeSettings(AUDIO_MODE_SETTINGS.daycore, 150).highPassFrequency).toBeNull();
  });

  it("clamps out-of-range intensity before scaling", () => {
    expect(scaleAudioModeSettings(AUDIO_MODE_SETTINGS.nightcore, 500).rate).toBeCloseTo(1.3, 10);
    expect(scaleAudioModeSettings(AUDIO_MODE_SETTINGS.nightcore, Number.NaN)).toBe(
      AUDIO_MODE_SETTINGS.nightcore,
    );
  });

  it("leaves untouched fields identical", () => {
    const scaled = scaleAudioModeSettings(AUDIO_MODE_SETTINGS.vaporwave, 130);
    expect(scaled.useBandPass).toBe(AUDIO_MODE_SETTINGS.vaporwave.useBandPass);
    expect(scaled.pan).toBe(AUDIO_MODE_SETTINGS.vaporwave.pan);
    expect(scaled.reverbSeconds).toBe(AUDIO_MODE_SETTINGS.vaporwave.reverbSeconds);
  });
});

describe("getAudioModeSettings", () => {
  it("ignores intensity for unsupported modes", () => {
    for (const mode of ALL_MODES) {
      if (audioModeSupportsIntensity(mode)) {
        continue;
      }
      expect(getAudioModeSettings(mode, 150)).toBe(AUDIO_MODE_SETTINGS[mode]);
    }
  });

  it("scales supported modes and defaults to 100%", () => {
    expect(getAudioModeSettings("nightcore")).toBe(
      AUDIO_MODE_SETTINGS.nightcore,
    );
    expect(getAudioModeSettings("nightcore", 150).rate).toBeCloseTo(1.3, 10);
  });
});
