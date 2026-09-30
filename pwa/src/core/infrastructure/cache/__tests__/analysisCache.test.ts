import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllAnalysisCache,
  deleteCachedAnalysis,
  getAnalysisCacheBytes,
  MemoryAnalysisCache,
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
  clearInstrumentalTracks: vi.fn(async () => undefined),
  deleteInstrumentalTrack: vi.fn(async () => undefined),
  getInstrumentalTrackBytes: vi.fn(async () => 0),
}));
vi.mock("@forever-jukebox/shared/audio/instrumentalTrackCache", () => instrumentals);

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
    instrumentals.clearInstrumentalTracks.mockClear();
    instrumentals.deleteInstrumentalTrack.mockClear();
    instrumentals.getInstrumentalTrackBytes.mockReset().mockResolvedValue(0);
    stubOpfs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts instrumental bytes with the analysis bytes", async () => {
    instrumentals.getInstrumentalTrackBytes.mockResolvedValue(5);
    expect(await getAnalysisCacheBytes()).toBe(15);
  });

  it("still reports analysis bytes when the instrumental count fails", async () => {
    instrumentals.getInstrumentalTrackBytes.mockRejectedValue(new Error("no cache"));
    expect(await getAnalysisCacheBytes()).toBe(10);
  });

  it("clears instrumentals with the whole cache", async () => {
    await clearAllAnalysisCache();
    expect(instrumentals.clearInstrumentalTracks).toHaveBeenCalledTimes(1);
  });

  it("deletes the instrumental stored under a fingerprint", async () => {
    const dir = stubOpfs();
    await deleteCachedAnalysis("abc");
    expect(dir.removeEntry).toHaveBeenCalledWith("abc.json");
    expect(instrumentals.deleteInstrumentalTrack).toHaveBeenCalledWith("abc");
  });
});
