import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const opus = vi.hoisted(() => ({
  canEncodeOpusWebm: vi.fn(async () => true),
  encodeOpusWebm: vi.fn(),
  decodeToStereo: vi.fn(),
}));
vi.mock("./opusWebm", () => opus);

import {
  clearRenderedTracks,
  deleteRenderedTracks,
  evictOldestRenderedTracks,
  getRenderedTrackBytes,
  listRenderedTrackBytes,
  readRenderedTrack,
  writeRenderedTrack,
} from "./renderedTrackCache";
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

function instrumental(trackId: string) {
  return { kind: "instrumental" as const, trackId };
}

function channels(frames: number, value = 0.5): StereoChannels {
  return [
    new Float32Array(frames).fill(value),
    new Float32Array(frames).fill(-value),
  ];
}

// Stand-in codec: left then right as raw floats, 8 bytes per frame.
async function fakeEncode([left, right]: StereoChannels) {
  const out = new Float32Array(left.length * 2);
  out.set(left);
  out.set(right, left.length);
  return out.buffer;
}

async function fakeDecode(bytes: ArrayBuffer): Promise<StereoChannels> {
  const all = new Float32Array(bytes);
  const frames = all.length / 2;
  return [all.slice(0, frames), all.slice(frames)];
}

describe("rendered track cache", () => {
  beforeEach(() => {
    vi.stubGlobal("caches", createCacheStorage());
    opus.canEncodeOpusWebm.mockReset().mockResolvedValue(true);
    opus.encodeOpusWebm.mockReset().mockImplementation(fakeEncode);
    opus.decodeToStereo.mockReset().mockImplementation(fakeDecode);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a stored track for the same id and length", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    expect(opus.encodeOpusWebm).toHaveBeenCalledWith(expect.any(Array), 44_100);

    const stored = await readRenderedTrack(instrumental("track-1"), 8, 48_000);

    expect(opus.decodeToStereo).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      48_000,
    );
    expect(stored?.[0]).toHaveLength(8);
    expect(stored?.[0][0]).toBe(0.5);
    expect(stored?.[1][0]).toBe(-0.5);
  });

  it("misses for an unknown track", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    expect(await readRenderedTrack(instrumental("track-2"), 8, 44_100)).toBeNull();
  });

  it("rejects an entry whose decoded length does not match the track", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    expect(
      await readRenderedTrack(instrumental("track-1"), 9, 44_100),
    ).not.toBeNull();
    expect(
      await readRenderedTrack(instrumental("track-1"), 4_000, 44_100),
    ).toBeNull();
  });

  it("replaces an earlier render of the same track", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(2, 0.25), 44_100);
    await writeRenderedTrack(instrumental("track-1"), channels(2, 0.75), 44_100);
    const stored = await readRenderedTrack(instrumental("track-1"), 2, 44_100);
    expect(stored?.[0][0]).toBe(0.75);
  });

  it("stores nothing when the browser cannot encode Opus", async () => {
    opus.canEncodeOpusWebm.mockResolvedValue(false);
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    expect(opus.encodeOpusWebm).not.toHaveBeenCalled();
    expect(await getRenderedTrackBytes()).toBe(0);
  });

  it("stores nothing and rejects when the encoder fails", async () => {
    opus.encodeOpusWebm.mockRejectedValue(new Error("no stream header"));
    await expect(
      writeRenderedTrack(instrumental("track-1"), channels(8), 44_100),
    ).rejects.toThrow("no stream header");
    expect(await getRenderedTrackBytes()).toBe(0);
  });

  it("reports and clears stored bytes", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    await writeRenderedTrack(instrumental("track-2"), channels(4), 44_100);
    expect(await getRenderedTrackBytes()).toBe(96);
    await clearRenderedTracks();
    expect(await getRenderedTrackBytes()).toBe(0);
    expect(await readRenderedTrack(instrumental("track-1"), 8, 44_100)).toBeNull();
  });

  it("lists each stored track's size by id", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    await writeRenderedTrack(
      instrumental("file name.mp3:12:34"),
      channels(4),
      44_100,
    );
    expect([...(await listRenderedTrackBytes())]).toEqual([
      ["track-1", 64],
      ["file name.mp3:12:34", 32],
    ]);
  });

  it("measures an entry stored without a recorded size", async () => {
    const cache = await caches.open("fj-rendered-tracks");
    await cache.put(
      "/rendered-track/instrumental/legacy",
      new Response(new Uint8Array(12)),
    );
    expect((await listRenderedTrackBytes()).get("legacy")).toBe(12);
  });

  it("keeps a track's kinds apart, sizes them together and deletes them together", async () => {
    const swing = { kind: "swing" as const, trackId: "track-1" };
    await writeRenderedTrack(instrumental("track-1"), channels(8, 0.25), 44_100);
    await writeRenderedTrack(swing, channels(8, 0.75), 44_100);

    expect(
      (await readRenderedTrack(instrumental("track-1"), 8, 44_100))?.[0][0],
    ).toBe(0.25);
    expect((await readRenderedTrack(swing, 8, 44_100))?.[0][0]).toBe(0.75);
    expect([...(await listRenderedTrackBytes())]).toEqual([["track-1", 128]]);

    await deleteRenderedTracks("track-1");
    expect(await readRenderedTrack(instrumental("track-1"), 8, 44_100)).toBeNull();
    expect(await readRenderedTrack(swing, 8, 44_100)).toBeNull();
  });

  it("ignores an entry stored under a different signature", async () => {
    const key = { kind: "swing" as const, trackId: "track-1", signature: "a" };
    await writeRenderedTrack(key, channels(8), 44_100);
    expect(await readRenderedTrack(key, 8, 44_100)).not.toBeNull();
    expect(
      await readRenderedTrack({ ...key, signature: "b" }, 8, 44_100),
    ).toBeNull();
    expect(
      await readRenderedTrack({ kind: "swing", trackId: "track-1" }, 8, 44_100),
    ).toBeNull();
  });

  it("deletes one stored track and leaves the rest", async () => {
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    await writeRenderedTrack(instrumental("track-2"), channels(4), 44_100);
    await deleteRenderedTracks("track-1");
    expect(await readRenderedTrack(instrumental("track-1"), 8, 44_100)).toBeNull();
    expect(
      await readRenderedTrack(instrumental("track-2"), 4, 44_100),
    ).not.toBeNull();
    await deleteRenderedTracks("track-missing");
  });

  it("evicts the tracks stored longest ago beyond the cap, sparing the kept one", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1);
    await writeRenderedTrack(instrumental("kept"), channels(8), 44_100);
    now.mockReturnValue(2);
    await writeRenderedTrack(instrumental("old"), channels(8), 44_100);
    now.mockReturnValue(3);
    await writeRenderedTrack({ kind: "swing", trackId: "mid" }, channels(8), 44_100);
    now.mockReturnValue(4);
    await writeRenderedTrack(instrumental("new"), channels(8), 44_100);

    await evictOldestRenderedTracks(256, "kept");
    expect((await listRenderedTrackBytes()).size).toBe(4);

    await evictOldestRenderedTracks(128, "kept");
    expect([...(await listRenderedTrackBytes()).keys()]).toEqual(["kept", "new"]);
  });

  it("does nothing without Cache Storage", async () => {
    vi.unstubAllGlobals();
    await writeRenderedTrack(instrumental("track-1"), channels(8), 44_100);
    expect(await readRenderedTrack(instrumental("track-1"), 8, 44_100)).toBeNull();
    expect(await getRenderedTrackBytes()).toBe(0);
    await expect(evictOldestRenderedTracks(0, null)).resolves.toBeUndefined();
    await expect(clearRenderedTracks()).resolves.toBeUndefined();
  });
});
