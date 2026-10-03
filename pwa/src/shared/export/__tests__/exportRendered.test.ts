import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportRenderedAudio, type JukeboxExportProgress } from "../exporter";
import {
  concatMp3ChunksWithFfmpeg,
  encodeAudioBufferWithFfmpeg,
} from "@/core/infrastructure/audio/ffmpegAudio";

vi.mock("../plan", () => ({ planJukeboxPath: vi.fn() }));
vi.mock("@/core/infrastructure/audio/ffmpegAudio", () => ({
  encodeAudioBufferWithFfmpeg: vi.fn(),
  concatMp3ChunksWithFfmpeg: vi.fn(),
}));

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly data: Float32Array[];
  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this.data = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }
  getChannelData(channel: number) {
    return this.data[channel] as Float32Array;
  }
}

function makeBuffer(seconds: number, sampleRate = 10, fill = 0.5) {
  const buffer = new FakeAudioBuffer({
    numberOfChannels: 2,
    length: seconds * sampleRate,
    sampleRate,
  });
  buffer.getChannelData(0).fill(fill);
  buffer.getChannelData(1).fill(-fill);
  return buffer as unknown as AudioBuffer;
}

describe("exportRenderedAudio", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
    vi.mocked(encodeAudioBufferWithFfmpeg).mockImplementation(
      async (_buffer, options) => {
        options.onProgress?.(0.5);
        return {
          bytes: new Uint8Array([1]),
          extension: options.format,
          mimeType: options.format === "mp3" ? "audio/mpeg" : "audio/wav",
        };
      },
    );
    vi.mocked(concatMp3ChunksWithFfmpeg).mockImplementation(async (chunks) => ({
      bytes: new Uint8Array(chunks.length),
      extension: "mp3",
      mimeType: "audio/mpeg",
    }));
  });

  it("encodes MP3 in chunks with the gain applied and reports progress", async () => {
    const events: JukeboxExportProgress[] = [];
    const result = await exportRenderedAudio({
      buffer: makeBuffer(250),
      format: "mp3",
      bitrateKbps: 128,
      gain: 0.5,
      onProgress: (event) => events.push(event),
    });

    const calls = vi.mocked(encodeAudioBufferWithFfmpeg).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls.map(([chunk]) => chunk.length)).toEqual([1200, 1200, 100]);
    expect(calls[0]?.[0].getChannelData(0)[0]).toBeCloseTo(0.25);
    expect(calls[0]?.[1]).toMatchObject({ format: "mp3", bitrateKbps: 128 });
    expect(result).toMatchObject({
      extension: "mp3",
      renderedDurationSeconds: 250,
      bytes: new Uint8Array(3),
    });
    const percents = events.map((event) => event.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
    expect(events.map((event) => event.message.kind)).toContain("combiningChunks");
  });

  it("encodes WAV whole and passes the buffer through at unity gain", async () => {
    const buffer = makeBuffer(20);
    const result = await exportRenderedAudio({ buffer, format: "wav" });
    expect(vi.mocked(encodeAudioBufferWithFfmpeg).mock.calls[0]?.[0]).toBe(buffer);
    expect(vi.mocked(concatMp3ChunksWithFfmpeg)).not.toHaveBeenCalled();
    expect(result.extension).toBe("wav");
  });

  it("scales WAV output when the gain is below unity", async () => {
    await exportRenderedAudio({ buffer: makeBuffer(2), format: "wav", gain: 0.1 });
    const encoded = vi.mocked(encodeAudioBufferWithFfmpeg).mock.calls[0]?.[0];
    expect(encoded?.getChannelData(1)[3]).toBeCloseTo(-0.05);
  });

  it("rejects an empty buffer", async () => {
    await expect(
      exportRenderedAudio({ buffer: makeBuffer(0), format: "wav" }),
    ).rejects.toThrow("empty");
  });
});
