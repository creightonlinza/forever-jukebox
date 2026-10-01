import { resampleStereoViews, type StereoChannels } from "./audioResample";

// Opus always codes at 48 kHz; other rates are converted on the way in.
export const OPUS_SAMPLE_RATE = 48_000;
const OPUS_BITRATE = 160_000;
const OPUS_CHANNELS = 2;
// Frames per AudioData handed to the encoder (multiple of Opus's 20 ms).
const ENCODE_BLOCK_FRAMES = 48_000;
// Blocks the encoder may hold before more are handed over.
const MAX_ENCODE_QUEUE = 8;
const ENCODE_QUEUE_POLL_MS = 4;
const CLUSTER_MS = 5_000;
// Opus decoders need this much audio before a seek point to converge.
const SEEK_PRE_ROLL_NS = 80_000_000;
const OPUS_HEAD_PRE_SKIP_OFFSET = 10;

export type OpusPacket = {
  timestampUs: number;
  data: Uint8Array;
};

// ---- EBML writing -------------------------------------------------------

function vint(value: number): Uint8Array {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) {
    length += 1;
  }
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let idx = length - 1; idx >= 0; idx -= 1) {
    bytes[idx] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 0x80 >> (length - 1);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function element(id: number[], payload: Uint8Array): Uint8Array {
  return concat([Uint8Array.from(id), vint(payload.length), payload]);
}

function uintPayload(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return Uint8Array.from(bytes);
}

function uint(id: number[], value: number) {
  return element(id, uintPayload(value));
}

function float(id: number[], value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return element(id, bytes);
}

function string(id: number[], value: string) {
  return element(id, new TextEncoder().encode(value));
}

function master(id: number[], children: Uint8Array[]) {
  return element(id, concat(children));
}

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87],
  DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimecodeScale: [0x2a, 0xd7, 0xb1],
  Duration: [0x44, 0x89],
  MuxingApp: [0x4d, 0x80],
  WritingApp: [0x57, 0x41],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackUID: [0x73, 0xc5],
  TrackType: [0x83],
  CodecID: [0x86],
  CodecPrivate: [0x63, 0xa2],
  CodecDelay: [0x56, 0xaa],
  SeekPreRoll: [0x56, 0xbb],
  Audio: [0xe1],
  SamplingFrequency: [0xb5],
  Channels: [0x9f],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Timecode: [0xe7],
  SimpleBlock: [0xa3],
};

export function readOpusPreSkip(opusHead: Uint8Array): number {
  return new DataView(
    opusHead.buffer,
    opusHead.byteOffset,
    opusHead.byteLength,
  ).getUint16(OPUS_HEAD_PRE_SKIP_OFFSET, true);
}

// Audio-only WebM with the Opus codec delay recorded, so decoders drop the
// encoder's priming samples and the audio starts where the source did.
export function muxOpusWebm(
  packets: OpusPacket[],
  opusHead: Uint8Array,
  durationSeconds: number,
): ArrayBuffer {
  const preSkipNs = Math.round(
    (readOpusPreSkip(opusHead) * 1e9) / OPUS_SAMPLE_RATE,
  );
  const header = master(ID.EBML, [
    uint(ID.EBMLVersion, 1),
    uint(ID.EBMLReadVersion, 1),
    uint(ID.EBMLMaxIDLength, 4),
    uint(ID.EBMLMaxSizeLength, 8),
    string(ID.DocType, "webm"),
    uint(ID.DocTypeVersion, 4),
    uint(ID.DocTypeReadVersion, 2),
  ]);
  const info = master(ID.Info, [
    uint(ID.TimecodeScale, 1_000_000),
    float(ID.Duration, durationSeconds * 1000),
    string(ID.MuxingApp, "forever-jukebox"),
    string(ID.WritingApp, "forever-jukebox"),
  ]);
  const tracks = master(ID.Tracks, [
    master(ID.TrackEntry, [
      uint(ID.TrackNumber, 1),
      uint(ID.TrackUID, 1),
      uint(ID.TrackType, 2),
      string(ID.CodecID, "A_OPUS"),
      element(ID.CodecPrivate, opusHead),
      uint(ID.CodecDelay, preSkipNs),
      uint(ID.SeekPreRoll, SEEK_PRE_ROLL_NS),
      master(ID.Audio, [
        float(ID.SamplingFrequency, OPUS_SAMPLE_RATE),
        uint(ID.Channels, OPUS_CHANNELS),
      ]),
    ]),
  ]);

  const clusters: Uint8Array[] = [];
  let clusterStartMs = 0;
  let blocks: Uint8Array[] = [];
  const flush = () => {
    if (blocks.length > 0) {
      clusters.push(
        master(ID.Cluster, [uint(ID.Timecode, clusterStartMs), ...blocks]),
      );
    }
    blocks = [];
  };
  for (const packet of packets) {
    const timestampMs = Math.round(packet.timestampUs / 1000);
    if (blocks.length > 0 && timestampMs - clusterStartMs >= CLUSTER_MS) {
      flush();
    }
    if (blocks.length === 0) {
      clusterStartMs = timestampMs;
    }
    const relative = timestampMs - clusterStartMs;
    const blockHeader = Uint8Array.from([
      0x81,
      (relative >> 8) & 0xff,
      relative & 0xff,
      0x80,
    ]);
    blocks.push(element(ID.SimpleBlock, concat([blockHeader, packet.data])));
  }
  flush();

  const segment = master(ID.Segment, [info, tracks, ...clusters]);
  return concat([header, segment]).buffer;
}

// ---- WebCodecs ----------------------------------------------------------

type EncoderConfig = {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
};

// WebCodecs typings are not in this package's lib; the pieces used here.
type EncodedChunk = {
  timestamp: number;
  byteLength: number;
  copyTo(target: Uint8Array): void;
};
type ChunkMetadata = { decoderConfig?: { description?: BufferSource } };
type AudioDataLike = { close(): void };
type AudioEncoderLike = {
  encodeQueueSize?: number;
  configure(config: EncoderConfig): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
};
type WebCodecs = {
  AudioEncoder: {
    new (init: {
      output: (chunk: EncodedChunk, metadata?: ChunkMetadata) => void;
      error: (error: Error) => void;
    }): AudioEncoderLike;
    isConfigSupported(config: EncoderConfig): Promise<{ supported?: boolean }>;
  };
  AudioData: new (init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }) => AudioDataLike;
};

const ENCODER_CONFIG: EncoderConfig = {
  codec: "opus",
  sampleRate: OPUS_SAMPLE_RATE,
  numberOfChannels: OPUS_CHANNELS,
  bitrate: OPUS_BITRATE,
};

function webCodecs(): WebCodecs | null {
  const scope = globalThis as Partial<WebCodecs>;
  return scope.AudioEncoder && scope.AudioData
    ? (scope as WebCodecs)
    : null;
}

export async function canEncodeOpusWebm(): Promise<boolean> {
  const codecs = webCodecs();
  if (!codecs) {
    return false;
  }
  try {
    const result = await codecs.AudioEncoder.isConfigSupported(ENCODER_CONFIG);
    return result.supported === true;
  } catch {
    return false;
  }
}

export async function encodeOpusWebm(
  channels: StereoChannels,
  sampleRate: number,
): Promise<ArrayBuffer> {
  const codecs = webCodecs();
  if (!codecs) {
    throw new Error("WebCodecs audio encoding is not available");
  }
  const [left, right] = await resampleStereoViews(
    channels,
    sampleRate,
    OPUS_SAMPLE_RATE,
  );
  const frames = Math.min(left.length, right.length);
  const packets: OpusPacket[] = [];
  let opusHead: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new codecs.AudioEncoder({
    output: (chunk, metadata) => {
      const description = metadata?.decoderConfig?.description;
      if (description && !opusHead) {
        opusHead =
          description instanceof ArrayBuffer
            ? new Uint8Array(description.slice(0))
            : new Uint8Array(
                description.buffer.slice(
                  description.byteOffset,
                  description.byteOffset + description.byteLength,
                ),
              );
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ timestampUs: chunk.timestamp, data });
    },
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure(ENCODER_CONFIG);
  for (let offset = 0; offset < frames; offset += ENCODE_BLOCK_FRAMES) {
    const count = Math.min(ENCODE_BLOCK_FRAMES, frames - offset);
    const planar = new Float32Array(count * OPUS_CHANNELS);
    planar.set(left.subarray(offset, offset + count), 0);
    planar.set(right.subarray(offset, offset + count), count);
    const block = new codecs.AudioData({
      format: "f32-planar",
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfFrames: count,
      numberOfChannels: OPUS_CHANNELS,
      timestamp: Math.round((offset * 1e6) / OPUS_SAMPLE_RATE),
      data: planar,
    });
    encoder.encode(block);
    block.close();
    while (!failure && (encoder.encodeQueueSize ?? 0) > MAX_ENCODE_QUEUE) {
      await new Promise((resolve) => setTimeout(resolve, ENCODE_QUEUE_POLL_MS));
    }
  }
  await encoder.flush();
  encoder.close();
  if (failure) {
    throw failure;
  }
  if (!opusHead) {
    throw new Error("Opus encoder produced no stream header");
  }
  return muxOpusWebm(packets, opusHead, frames / OPUS_SAMPLE_RATE);
}

// Decodes through the same path the app uses for streamed tracks, so codec
// delay and sample-rate conversion are handled by the browser.
export async function decodeToStereo(
  bytes: ArrayBuffer,
  sampleRate: number,
): Promise<StereoChannels> {
  const offline = new OfflineAudioContext(OPUS_CHANNELS, 1, sampleRate);
  const decoded = await offline.decodeAudioData(bytes);
  const left = new Float32Array(decoded.getChannelData(0));
  const right = new Float32Array(
    decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0),
  );
  return [left, right];
}
