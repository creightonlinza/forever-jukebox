import { describe, expect, it } from "vitest";
import {
  cleanErrorMessage,
  formatErrorForDisplay,
  inferSourceProviderFromUrl,
} from "./errorDisplay";

describe("errorDisplay", () => {
  it("strips repeated Error prefixes", () => {
    expect(cleanErrorMessage("Error: ERROR: Unable to download video data."))
      .toBe("Unable to download video data.");
  });

  it("strips API ERROR prefixes", () => {
    expect(cleanErrorMessage("ERROR: No beats or downbeats were detected in this audio."))
      .toBe("No beats or downbeats were detected in this audio.");
  });

  it("preserves meaningful track errors", () => {
    expect(formatErrorForDisplay(
      "ERROR: No beats or downbeats were detected in this audio.",
      { errorCode: "no_beats_detected", sourceProvider: "youtube" },
    )).toBe("No beats or downbeats were detected in this audio.");
    expect(formatErrorForDisplay(
      "Error: Sorry, the max track length for this server is 12 minutes.",
      { errorCode: "track_too_long", sourceProvider: "youtube" },
    )).toBe("Sorry, the max track length for this server is 12 minutes.");
  });

  it("uses source-specific copy for fetch failures", () => {
    expect(formatErrorForDisplay(
      "ERROR: Unable to download video data.",
      { errorCode: "download_unavailable", sourceProvider: "soundcloud" },
    )).toBe("SoundCloud fetch failed.");
    expect(formatErrorForDisplay(
      Object.assign(new Error("Error: ERROR: Unable to reach YouTube"), {
        code: "youtube_unreachable",
      }),
      { sourceProvider: "youtube" },
    )).toBe("YouTube fetch failed.");
  });

  it("falls back for unknown errors", () => {
    expect(formatErrorForDisplay(null, { fallback: "Load failed." }))
      .toBe("Load failed.");
  });

  it("infers supported providers from URLs", () => {
    expect(inferSourceProviderFromUrl("https://soundcloud.com/artist/track"))
      .toBe("soundcloud");
    expect(inferSourceProviderFromUrl("https://artist.bandcamp.com/track/song"))
      .toBe("bandcamp");
    expect(inferSourceProviderFromUrl("dQw4w9WgXcQ")).toBe("youtube");
  });
});
