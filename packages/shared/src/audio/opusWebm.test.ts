import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPUS_SAMPLE_RATE,
  canEncodeOpusWebm,
  decodeToStereo,
  encodeOpusWebm,
  muxOpusWebm,
  readOpusPreSkip,
} from "./opusWebm";

// Minimal EBML reader for assertions: returns the elements of one level.
function readElements(bytes: Uint8Array, start = 0, end = bytes.length) {
  const elements: { id: string; payload: Uint8Array }[] = [];
  let offset = start;
  const readVint = (keepMarker: boolean) => {
    const first = bytes[offset];
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) {
      length += 1;
    }
    let value = keepMarker ? first : first & (0xff >> length);
    for (let idx = 1; idx < length; idx += 1) {
      value = value * 256 + bytes[offset + idx];
    }
    offset += length;
    return value;
  };
  while (offset < end) {
    const idStart = offset;
    readVint(true);
    const id = Array.from(bytes.subarray(idStart, offset))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const size = readVint(false);
    elements.push({ id, payload: bytes.subarray(offset, offset + size) });
    offset += size;
  }
  return elements;
}

function uintOf(payload: Uint8Array) {
  return payload.reduce((value, byte) => value * 256 + byte, 0);
}

function opusHead(preSkip: number) {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1;
  head[9] = 2;
  new DataView(head.buffer).setUint16(10, preSkip, true);
  new DataView(head.buffer).setUint32(12, 48_000, true);
  return head;
}

describe("muxOpusWebm", () => {
  it("writes a WebM header, an Opus track with its codec delay, and blocks", () => {
    const packets = [
      { timestampUs: 0, data: Uint8Array.from([1, 2]) },
      { timestampUs: 20_000, data: Uint8Array.from([3]) },
      { timestampUs: 6_000_000, data: Uint8Array.from([4, 5, 6]) },
    ];
    const bytes = new Uint8Array(muxOpusWebm(packets, opusHead(312), 6.02));
    const [ebml, segment] = readElements(bytes);

    expect(ebml.id).toBe("1a45dfa3");
    const docType = readElements(ebml.payload).find((el) => el.id === "4282");
    expect(new TextDecoder().decode(docType?.payload)).toBe("webm");

    expect(segment.id).toBe("18538067");
    const segmentChildren = readElements(segment.payload);
    expect(segmentChildren.map((el) => el.id)).toEqual([
      "1549a966",
      "1654ae6b",
      "1f43b675",
      "1f43b675",
    ]);

    const track = readElements(
      readElements(segmentChildren[1].payload)[0].payload,
    );
    const byId = Object.fromEntries(track.map((el) => [el.id, el.payload]));
    expect(new TextDecoder().decode(byId["86"])).toBe("A_OPUS");
    expect(Array.from(byId["63a2"])).toEqual(Array.from(opusHead(312)));
    // 312 samples of priming at 48 kHz, in nanoseconds.
    expect(uintOf(byId["56aa"])).toBe(6_500_000);
    expect(uintOf(byId["56bb"])).toBe(80_000_000);
    const audio = readElements(byId["e1"]);
    expect(uintOf(audio.find((el) => el.id === "9f")!.payload)).toBe(2);

    const firstCluster = readElements(segmentChildren[2].payload);
    expect(uintOf(firstCluster[0].payload)).toBe(0);
    expect(firstCluster.filter((el) => el.id === "a3")).toHaveLength(2);
    const secondBlock = firstCluster[2].payload;
    expect(Array.from(secondBlock)).toEqual([0x81, 0, 20, 0x80, 3]);

    const secondCluster = readElements(segmentChildren[3].payload);
    expect(uintOf(secondCluster[0].payload)).toBe(6000);
    expect(Array.from(secondCluster[1].payload)).toEqual([0x81, 0, 0, 0x80, 4, 5, 6]);
  });

  it("reads the pre-skip from an OpusHead", () => {
    expect(readOpusPreSkip(opusHead(312))).toBe(312);
  });
});

describe("encodeOpusWebm", () => {
  class FakeAudioData {
    constructor(public init: { numberOfFrames: number; timestamp: number }) {}
    close = vi.fn();
  }
  const encoded: FakeAudioData[] = [];

  class FakeAudioEncoder {
    static supported = true;
    static isConfigSupported = vi.fn(async () => ({
      supported: FakeAudioEncoder.supported,
    }));
    output: (chunk: unknown, metadata?: unknown) => void;
    constructor(init: { output: (chunk: unknown, metadata?: unknown) => void }) {
      this.output = init.output;
    }
    configure = vi.fn();
    encode(data: FakeAudioData) {
      encoded.push(data);
      const packet = {
        timestamp: data.init.timestamp,
        byteLength: 2,
        copyTo: (target: Uint8Array) => target.set([9, 9]),
      };
      this.output(
        packet,
        encoded.length === 1
          ? { decoderConfig: { description: opusHead(312) } }
          : undefined,
      );
    }
    flush = vi.fn(async () => undefined);
    close = vi.fn();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    encoded.length = 0;
    FakeAudioEncoder.supported = true;
  });

  it("reports support only when WebCodecs offers the Opus config", async () => {
    expect(await canEncodeOpusWebm()).toBe(false);
    vi.stubGlobal("AudioEncoder", FakeAudioEncoder);
    vi.stubGlobal("AudioData", FakeAudioData);
    expect(await canEncodeOpusWebm()).toBe(true);
    FakeAudioEncoder.supported = false;
    expect(await canEncodeOpusWebm()).toBe(false);
  });

  it("feeds 48 kHz blocks to the encoder and muxes its packets", async () => {
    vi.stubGlobal("AudioEncoder", FakeAudioEncoder);
    vi.stubGlobal("AudioData", FakeAudioData);
    const frames = OPUS_SAMPLE_RATE * 2 + 10;
    const bytes = await encodeOpusWebm(
      [new Float32Array(frames), new Float32Array(frames)],
      OPUS_SAMPLE_RATE,
    );

    expect(encoded.map((data) => data.init.numberOfFrames)).toEqual([
      OPUS_SAMPLE_RATE,
      OPUS_SAMPLE_RATE,
      10,
    ]);
    expect(encoded[1].init.timestamp).toBe(1_000_000);
    expect(encoded.every((data) => data.close.mock.calls.length === 1)).toBe(
      true,
    );
    const [, segment] = readElements(new Uint8Array(bytes));
    const clusters = readElements(segment.payload).filter(
      (el) => el.id === "1f43b675",
    );
    const blocks = clusters.flatMap((cluster) =>
      readElements(cluster.payload).filter((el) => el.id === "a3"),
    );
    expect(blocks).toHaveLength(3);
  });

  it("fails when the encoder never reports a stream header", async () => {
    class HeaderlessEncoder extends FakeAudioEncoder {
      encode(data: FakeAudioData) {
        encoded.push(data);
        this.output({ timestamp: 0, byteLength: 0, copyTo: () => undefined });
      }
    }
    vi.stubGlobal("AudioEncoder", HeaderlessEncoder);
    vi.stubGlobal("AudioData", FakeAudioData);
    await expect(
      encodeOpusWebm([new Float32Array(10), new Float32Array(10)], 48_000),
    ).rejects.toThrow(/stream header/);
  });
});

describe("decodeToStereo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes through an offline context at the requested rate", async () => {
    const decodeAudioData = vi.fn(async () => ({
      numberOfChannels: 2,
      getChannelData: (index: number) => new Float32Array([index, index]),
    }));
    class FakeOfflineAudioContext {
      constructor(
        public channels: number,
        public length: number,
        public sampleRate: number,
      ) {}
      decodeAudioData = decodeAudioData;
    }
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);

    const [left, right] = await decodeToStereo(new ArrayBuffer(4), 44_100);

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(Array.from(left)).toEqual([0, 0]);
    expect(Array.from(right)).toEqual([1, 1]);
  });
});
