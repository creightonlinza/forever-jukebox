import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { JukeboxExportProgress } from "@/shared/export";
import {
  buildAudioExportName,
  exportErrorMessage,
  exportProgressMessage,
} from "./exportAudio";

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe("audio export helpers", () => {
  it("builds export file names from the source name", () => {
    expect(buildAudioExportName("song.wav", "mp3")).toBe("song_forever.mp3");
    expect(buildAudioExportName("a.b.c", "wav")).toBe("a.b_forever.wav");
    expect(buildAudioExportName(".mp3", "wav")).toBe("jukebox_forever.wav");
    expect(buildAudioExportName("  ", "mp3")).toBe("jukebox_forever.mp3");
  });

  it("maps the exporter's error strings to translation keys", () => {
    expect(
      exportErrorMessage(
        new Error(
          "WAV export is too large for browser memory at this duration. Use MP3 for long exports.",
        ),
        t,
      ),
    ).toBe("export.wavTooLarge");
    expect(
      exportErrorMessage(new Error("Swing export requires beat analysis."), t),
    ).toBe("export.swingNeedsBeats");
    expect(exportErrorMessage(new Error("boom"), t)).toBe("export.failed");
    expect(exportErrorMessage("not an error", t)).toBe("export.failed");
  });

  it("describes every progress message kind", () => {
    const cases: Array<[JukeboxExportProgress["message"], string]> = [
      [{ kind: "initializing" }, "export.initializing"],
      [{ kind: "preparingSwing" }, "listen.preparingSwing"],
      [{ kind: "planning" }, "export.planning"],
      [
        { kind: "renderingChunk", chunk: 2, total: 5 },
        'export.renderingChunk:{"kind":"renderingChunk","chunk":2,"total":5}',
      ],
      [
        { kind: "encodingChunk", chunk: 3, total: 5 },
        'export.encodingChunk:{"kind":"encodingChunk","chunk":3,"total":5}',
      ],
      [{ kind: "combiningChunks" }, "export.combiningChunks"],
      [{ kind: "renderingAudio" }, "export.renderingAudio"],
      [
        { kind: "encodingFormat", format: "MP3" },
        'export.encodingFormat:{"kind":"encodingFormat","format":"MP3"}',
      ],
      [{ kind: "finalizing" }, "export.finalizing"],
    ];
    for (const [message, expected] of cases) {
      expect(exportProgressMessage(message, t)).toBe(expected);
    }
  });
});
