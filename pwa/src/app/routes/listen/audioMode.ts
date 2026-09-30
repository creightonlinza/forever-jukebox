import type { TFunction } from "i18next";
import type { JukeboxAudioMode } from "@forever-jukebox/shared/audio/BufferedAudioPlayer";
import { isInstrumentalModeAvailable } from "@forever-jukebox/shared/audio/instrumentalRenderer";
import {
  AUDIO_MODE_INTENSITY_PARAM,
  DEFAULT_AUDIO_MODE_INTENSITY,
  parseAudioModeIntensityParam,
  setAudioModeIntensityParam,
} from "@forever-jukebox/shared/audio/audioModes";

export const AUDIO_MODE_QUERY_KEY = "am";

export type AudioModeSection = {
  titleKey: "audioModes.playbackStyles" | "audioModes.remixToys";
  options: JukeboxAudioMode[];
};

export const AUDIO_MODE_SECTIONS: AudioModeSection[] = [
  {
    titleKey: "audioModes.playbackStyles",
    options: [
      "nightcore",
      "daycore",
      "vaporwave",
      "eight_d",
      "lofi",
      "eight_bit",
      "underwater",
      "cathedral",
    ],
  },
  {
    titleKey: "audioModes.remixToys",
    options: ["cowbell", "swing", "instrumental"],
  },
];

export function audioModeLabel(audioMode: JukeboxAudioMode, t: TFunction) {
  const keys: Record<
    JukeboxAudioMode,
    | "common.off"
    | "audioModes.nightcore"
    | "audioModes.daycore"
    | "audioModes.vaporwave"
    | "audioModes.eightD"
    | "audioModes.lofi"
    | "audioModes.eightBit"
    | "audioModes.underwater"
    | "audioModes.cathedral"
    | "audioModes.cowbell"
    | "audioModes.swing"
    | "audioModes.instrumental"
  > = {
    off: "common.off",
    nightcore: "audioModes.nightcore",
    daycore: "audioModes.daycore",
    vaporwave: "audioModes.vaporwave",
    eight_d: "audioModes.eightD",
    lofi: "audioModes.lofi",
    eight_bit: "audioModes.eightBit",
    underwater: "audioModes.underwater",
    cathedral: "audioModes.cathedral",
    cowbell: "audioModes.cowbell",
    swing: "audioModes.swing",
    instrumental: "audioModes.instrumental",
  };
  return t(keys[audioMode]);
}

export function formatAudioModeTitleLabel(audioMode: JukeboxAudioMode, t: TFunction) {
  return audioModeLabel(audioMode, t).toLocaleLowerCase();
}

export function getAudioModeInputId(mode: JukeboxAudioMode) {
  return `audio-mode-${mode.replaceAll("_", "-")}`;
}

// Modes hidden on this device parse to null so shared links fall back.
export function isAudioModeOffered(mode: JukeboxAudioMode): boolean {
  return mode !== "instrumental" || isInstrumentalModeAvailable();
}

export function parseAudioMode(value: string | null): JukeboxAudioMode | null {
  if (value === "instrumental") {
    return isAudioModeOffered(value) ? value : null;
  }
  if (
    value === "off" ||
    value === "nightcore" ||
    value === "daycore" ||
    value === "vaporwave" ||
    value === "eight_d" ||
    value === "eight_bit" ||
    value === "lofi" ||
    value === "underwater" ||
    value === "cathedral" ||
    value === "cowbell" ||
    value === "swing"
  ) {
    return value;
  }
  return null;
}

export function resolveAudioModeFromUrl(): JukeboxAudioMode {
  if (typeof window === "undefined") {
    return "off";
  }
  const params = new URLSearchParams(window.location.search);
  return parseAudioMode(params.get(AUDIO_MODE_QUERY_KEY)) ?? "off";
}

export function resolveAudioIntensityFromUrl(): number {
  if (typeof window === "undefined") {
    return DEFAULT_AUDIO_MODE_INTENSITY;
  }
  const params = new URLSearchParams(window.location.search);
  return parseAudioModeIntensityParam(
    params.get(AUDIO_MODE_INTENSITY_PARAM),
    parseAudioMode(params.get(AUDIO_MODE_QUERY_KEY)),
  );
}

export function writeAudioModeToUrl(
  mode: JukeboxAudioMode,
  intensityPct: number,
  replace = true,
) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (mode === "off") {
    url.searchParams.delete(AUDIO_MODE_QUERY_KEY);
  } else {
    url.searchParams.set(AUDIO_MODE_QUERY_KEY, mode);
  }
  setAudioModeIntensityParam(url.searchParams, mode, intensityPct);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
    return;
  }
  window.history.pushState({}, "", url.toString());
}
