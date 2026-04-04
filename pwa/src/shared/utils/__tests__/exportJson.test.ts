import { describe, expect, it } from "vitest";
import { formatExportJson } from "../exportJson";
import { createTestAnalysis } from "@/shared/analysis-schema/testData";

const analysis = createTestAnalysis();

describe("export JSON", () => {
  it("pretty prints and includes metadata", () => {
    const json = formatExportJson(analysis, {
      createdAt: "2026-02-11T00:00:00.000Z",
      appVersion: "0.1.0",
      fingerprint: "abc",
    });
    const parsed = JSON.parse(json);
    expect(parsed.metadata.fingerprint).toBe("abc");
    expect(parsed.engine_version).toBe(1);
    expect(parsed.engine_origin).toBe("forever-jukebox-pwa");
    expect(json.includes("\n  \"metadata\"")).toBe(true);
  });
});
