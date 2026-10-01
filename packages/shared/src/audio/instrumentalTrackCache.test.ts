import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const opus = vi.hoisted(() => ({
  canEncodeOpusWebm: vi.fn(async () => false),
  encodeOpusWebm: vi.fn(),
  decodeToStereo: vi.fn(),
}));
vi.mock("./opusWebm", () => opus);

import {
  clearInstrumentalTracks,
  decodeInstrumentalTrack,
  deleteInstrumentalTrack,
  encodeInstrumentalTrack,
  getInstrumentalTrackBytes,
  listInstrumentalTrackBytes,
  readInstrumentalTrack,
  writeInstrumentalTrack,
} from "./instrumentalTrackCache";
import type { StereoChannels } from "./audioResample";

// Minimal Cache Storage: insertion-ordered, keyed by URL.
function createCacheStorage() {
  const stores = new Map<
    string,
    Map<string, { bytes: ArrayBuffer; headers: [string, string][] }>
  >();
  const open = async (name: string) => {
    let entries = stores.get(name);
    if (!entries) {
      entries = new Map();
      stores.set(name, entries);
    }
    const store = entries;
    const urlOf = (key: string | { url: string }) =>
      typeof key === "string" ? key : key.url;
    return {
      match: async (key: string | { url: string }) => {
        const entry = store.get(urlOf(key));
        return entry
          ? new Response(entry.bytes.slice(0), { headers: entry.headers })
          : undefined;
      },
      put: async (key: string, response: Response) => {
        store.set(key, {
          bytes: await response.arrayBuffer(),
          headers: [...response.headers.entries()],
        });
      },
      delete: async (key: string | { url: string }) =>
        store.delete(urlOf(key)),
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
  };
  return {
    open,
    delete: async (name: string) => stores.delete(name),
  };
}

function channels(frames: number, value = 0.5): StereoChannels {
  return [
    new Float32Array(frames).fill(value),
    new Float32Array(frames).fill(-value),
  ];
}

describe("instrumental track encoding", () => {
  it("round-trips within 16-bit precision", () => {
    const left = new Float32Array([0, 0.25, -0.5, 1, -1]);
    const right = new Float32Array([0.1, -0.1, 0.9, -0.9, 0]);
    const [outLeft, outRight] = decodeInstrumentalTrack(
      encodeInstrumentalTrack([left, right]),
    );
    for (let idx = 0; idx < left.length; idx += 1) {
      expect(outLeft[idx]).toBeCloseTo(left[idx], 4);
      expect(outRight[idx]).toBeCloseTo(right[idx], 4);
    }
  });

  it("clamps samples outside the valid range", () => {
    const [left] = decodeInstrumentalTrack(
      encodeInstrumentalTrack([
        new Float32Array([1.5, -1.5]),
        new Float32Array(2),
      ]),
    );
    expect(Array.from(left)).toEqual([1, -1]);
  });
});

describe("instrumental track cache", () => {
  beforeEach(() => {
    vi.stubGlobal("caches", createCacheStorage());
    opus.canEncodeOpusWebm.mockReset().mockResolvedValue(false);
    opus.encodeOpusWebm.mockReset();
    opus.decodeToStereo.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a stored track for the same id and length", async () => {
    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    const stored = await readInstrumentalTrack("track-1", 8, 44_100);
    expect(stored?.[0]).toHaveLength(8);
    expect(stored?.[0][0]).toBeCloseTo(0.5, 4);
    expect(stored?.[1][0]).toBeCloseTo(-0.5, 4);
  });

  it("misses for an unknown track or a different length", async () => {
    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    expect(await readInstrumentalTrack("track-2", 8, 44_100)).toBeNull();
    expect(await readInstrumentalTrack("track-1", 9, 44_100)).toBeNull();
  });

  it("keeps every stored track", async () => {
    for (let idx = 0; idx < 25; idx += 1) {
      await writeInstrumentalTrack(`track-${idx}`, channels(2), 44_100);
    }
    expect(await readInstrumentalTrack("track-0", 2, 44_100)).not.toBeNull();
    expect(await readInstrumentalTrack("track-24", 2, 44_100)).not.toBeNull();
  });

  it("replaces an earlier render of the same track", async () => {
    await writeInstrumentalTrack("track-1", channels(2, 0.25), 44_100);
    await writeInstrumentalTrack("track-1", channels(2, 0.75), 44_100);
    const stored = await readInstrumentalTrack("track-1", 2, 44_100);
    expect(stored?.[0][0]).toBeCloseTo(0.75, 4);
  });

  it("reports and clears stored bytes", async () => {
    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    await writeInstrumentalTrack("track-2", channels(4), 44_100);
    expect(await getInstrumentalTrackBytes()).toBe(48);
    await clearInstrumentalTracks();
    expect(await getInstrumentalTrackBytes()).toBe(0);
    expect(await readInstrumentalTrack("track-1", 8, 44_100)).toBeNull();
  });

  it("lists each stored track's size by id", async () => {
    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    await writeInstrumentalTrack("file name.mp3:12:34", channels(4), 44_100);
    expect([...(await listInstrumentalTrackBytes())]).toEqual([
      ["track-1", 32],
      ["file name.mp3:12:34", 16],
    ]);
  });

  it("measures an entry stored without a recorded size", async () => {
    const cache = await caches.open("fj-instrumental-tracks");
    await cache.put(
      "/instrumental-track/legacy",
      new Response(new Uint8Array(12)),
    );
    expect((await listInstrumentalTrackBytes()).get("legacy")).toBe(12);
  });

  it("deletes one stored track and leaves the rest", async () => {
    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    await writeInstrumentalTrack("track-2", channels(4), 44_100);
    await deleteInstrumentalTrack("track-1");
    expect(await readInstrumentalTrack("track-1", 8, 44_100)).toBeNull();
    expect(await readInstrumentalTrack("track-2", 4, 44_100)).not.toBeNull();
    await deleteInstrumentalTrack("track-missing");
  });

  it("stores PCM when the Opus encoder fails", async () => {
    opus.canEncodeOpusWebm.mockResolvedValue(true);
    opus.encodeOpusWebm.mockRejectedValue(new Error("no stream header"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await writeInstrumentalTrack("track-1", channels(8), 44_100);

    expect(warn).toHaveBeenCalled();
    const stored = await readInstrumentalTrack("track-1", 8, 44_100);
    expect(stored?.[0][0]).toBeCloseTo(0.5, 4);
    expect(opus.decodeToStereo).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stores WebM/Opus when the browser can encode it", async () => {
    opus.canEncodeOpusWebm.mockResolvedValue(true);
    opus.encodeOpusWebm.mockResolvedValue(new Uint8Array([7, 7, 7]).buffer);
    opus.decodeToStereo.mockResolvedValue([
      new Float32Array(8).fill(0.5),
      new Float32Array(8).fill(-0.5),
    ]);

    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    expect(opus.encodeOpusWebm).toHaveBeenCalledWith(
      expect.any(Array),
      44_100,
    );
    const stored = await readInstrumentalTrack("track-1", 8, 48_000);

    expect(opus.decodeToStereo).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      48_000,
    );
    expect(stored?.[0][0]).toBe(0.5);
    expect(await getInstrumentalTrackBytes()).toBe(3);
  });

  it("rejects a decoded entry whose length does not match the track", async () => {
    opus.canEncodeOpusWebm.mockResolvedValue(true);
    opus.encodeOpusWebm.mockResolvedValue(new Uint8Array([7]).buffer);
    opus.decodeToStereo.mockResolvedValue([
      new Float32Array(8),
      new Float32Array(8),
    ]);

    await writeInstrumentalTrack("track-1", channels(8), 44_100);

    expect(await readInstrumentalTrack("track-1", 9, 44_100)).not.toBeNull();
    expect(await readInstrumentalTrack("track-1", 4_000, 44_100)).toBeNull();
  });

  it("does nothing without Cache Storage", async () => {
    vi.unstubAllGlobals();
    await writeInstrumentalTrack("track-1", channels(8), 44_100);
    expect(await readInstrumentalTrack("track-1", 8, 44_100)).toBeNull();
    expect(await getInstrumentalTrackBytes()).toBe(0);
    await expect(clearInstrumentalTracks()).resolves.toBeUndefined();
  });
});
