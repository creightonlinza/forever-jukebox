import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../fingerprint";

function makeFile(bytes: number[], name = "song.wav", lastModified = 1234) {
  return new File([new Uint8Array(bytes)], name, { lastModified });
}

describe("computeFingerprint", () => {
  it("includes name, size, lastModified, hash", async () => {
    const file = makeFile([1, 2, 3, 4, 5]);
    const fingerprint = await computeFingerprint(file, 3);
    expect(fingerprint.startsWith("v1-song.wav-5-1234-")).toBe(true);
  });
});
