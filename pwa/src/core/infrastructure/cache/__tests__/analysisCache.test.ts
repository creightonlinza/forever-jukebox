import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllAnalysisCache,
  deleteCachedAnalysis,
  getAnalysisCacheBytes,
  MemoryAnalysisCache,
  trimRenderedTracks,
} from "../analysisCache";
import { createTestAnalysis } from "@/shared/analysis-schema/testData";

const analysis = createTestAnalysis();

describe("MemoryAnalysisCache", () => {
  it("stores and retrieves analysis", async () => {
    const cache = new MemoryAnalysisCache();
    await cache.set("fingerprint", analysis);
    const stored = await cache.get("fingerprint");
    expect(stored).toEqual(analysis);
  });

  it("clears entries", async () => {
    const cache = new MemoryAnalysisCache();
    await cache.set("fingerprint", analysis);
    await cache.clear("fingerprint");
    const stored = await cache.get("fingerprint");
    expect(stored).toBeNull();
  });
});

const instrumentals = vi.hoisted(() => ({
  clearRenderedTracks: vi.fn(async () => undefined),
  deleteRenderedTracks: vi.fn(async () => undefined),
  evictOldestRenderedTracks: vi.fn(async () => undefined),
  getRenderedTrackBytes: vi.fn(async () => 0),
}));
vi.mock("@forever-jukebox/shared/audio/renderedTrackCache", () => instrumentals);

// Fake OPFS root: an analysis directory with one 10-byte file.
function stubOpfs() {
  const file = { kind: "file", getFile: async () => ({ size: 10 }) };
  const dir = {
    values: () => (async function* () {
      yield file;
    })(),
    removeEntry: vi.fn(async () => undefined),
  };
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: async () => ({
        getDirectoryHandle: async () => dir,
        removeEntry: vi.fn(async () => undefined),
      }),
    },
  });
  return dir;
}

describe("stored instrumentals follow the analysis cache", () => {
  beforeEach(() => {
    instrumentals.clearRenderedTracks.mockClear();
    instrumentals.deleteRenderedTracks.mockClear();
    instrumentals.getRenderedTrackBytes.mockReset().mockResolvedValue(0);
    stubOpfs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts instrumental bytes with the analysis bytes", async () => {
    instrumentals.getRenderedTrackBytes.mockResolvedValue(5);
    expect(await getAnalysisCacheBytes()).toBe(15);
  });

  it("still reports analysis bytes when the instrumental count fails", async () => {
    instrumentals.getRenderedTrackBytes.mockRejectedValue(new Error("no cache"));
    expect(await getAnalysisCacheBytes()).toBe(10);
  });

  it("trims stored renders to 500 MB, sparing the given track", async () => {
    await trimRenderedTracks("abc");
    expect(instrumentals.evictOldestRenderedTracks).toHaveBeenCalledWith(
      500 * 1024 * 1024,
      "abc",
    );
  });

  it("clears instrumentals with the whole cache", async () => {
    await clearAllAnalysisCache();
    expect(instrumentals.clearRenderedTracks).toHaveBeenCalledTimes(1);
  });

  it("still removes the analysis when the instrumental delete fails", async () => {
    instrumentals.deleteRenderedTracks.mockRejectedValueOnce(new Error("blocked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = stubOpfs();
    await expect(deleteCachedAnalysis("abc")).resolves.toBeUndefined();
    expect(dir.removeEntry).toHaveBeenCalledWith("abc.json");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("deletes the instrumental stored under a fingerprint", async () => {
    const dir = stubOpfs();
    await deleteCachedAnalysis("abc");
    expect(dir.removeEntry).toHaveBeenCalledWith("abc.json");
    expect(instrumentals.deleteRenderedTracks).toHaveBeenCalledWith("abc");
  });
});
