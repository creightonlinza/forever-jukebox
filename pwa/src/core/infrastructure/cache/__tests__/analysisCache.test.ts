import { describe, expect, it } from "vitest";
import { MemoryAnalysisCache } from "../analysisCache";
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
