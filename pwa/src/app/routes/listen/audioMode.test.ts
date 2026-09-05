import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_MODE_INTENSITY } from "@forever-jukebox/shared/audio/audioModes";
import {
  parseAudioMode,
  resolveAudioIntensityFromUrl,
  resolveAudioModeFromUrl,
  writeAudioModeToUrl,
} from "./audioMode";

function currentParams() {
  return new URL(window.location.href).searchParams;
}

describe("audio mode URL helpers", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses only known audio modes", () => {
    const modes = [
      "off",
      "nightcore",
      "daycore",
      "vaporwave",
      "eight_d",
      "eight_bit",
      "lofi",
      "underwater",
      "cathedral",
      "cowbell",
      "swing",
    ];
    for (const mode of modes) {
      expect(parseAudioMode(mode)).toBe(mode);
    }
    expect(parseAudioMode("eight-bit")).toBeNull();
    expect(parseAudioMode("")).toBeNull();
    expect(parseAudioMode(null)).toBeNull();
  });

  it("reads mode and intensity from the URL with defaults", () => {
    expect(resolveAudioModeFromUrl()).toBe("off");
    expect(resolveAudioIntensityFromUrl()).toBe(DEFAULT_AUDIO_MODE_INTENSITY);

    window.history.replaceState({}, "", "/?am=nightcore&ai=150");
    expect(resolveAudioModeFromUrl()).toBe("nightcore");
    expect(resolveAudioIntensityFromUrl()).toBe(150);

    window.history.replaceState({}, "", "/?am=bogus&ai=150");
    expect(resolveAudioModeFromUrl()).toBe("off");
    expect(resolveAudioIntensityFromUrl()).toBe(DEFAULT_AUDIO_MODE_INTENSITY);
  });

  it("writes mode and intensity params and clears them for off", () => {
    writeAudioModeToUrl("nightcore", 150);
    expect(currentParams().get("am")).toBe("nightcore");
    expect(currentParams().get("ai")).toBe("150");

    writeAudioModeToUrl("nightcore", DEFAULT_AUDIO_MODE_INTENSITY);
    expect(currentParams().get("am")).toBe("nightcore");
    expect(currentParams().has("ai")).toBe(false);

    writeAudioModeToUrl("off", 150);
    expect(currentParams().has("am")).toBe(false);
    expect(currentParams().has("ai")).toBe(false);
  });

  it("replaces history by default and pushes when asked", () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");

    writeAudioModeToUrl("lofi", DEFAULT_AUDIO_MODE_INTENSITY);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();

    writeAudioModeToUrl("cowbell", DEFAULT_AUDIO_MODE_INTENSITY, false);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(currentParams().get("am")).toBe("cowbell");
  });
});
