import { describe, expect, it } from "vitest";
import { clampVolume, parseStoredVolumePct } from "./volume";

describe("parseStoredVolumePct", () => {
  it("defaults to full volume when nothing is stored", () => {
    expect(parseStoredVolumePct(null)).toBe(100);
  });

  it("keeps stored values, including mute", () => {
    expect(parseStoredVolumePct("42")).toBe(42);
    expect(parseStoredVolumePct("0")).toBe(0);
  });

  it("clamps out-of-range values and ignores garbage", () => {
    expect(parseStoredVolumePct("150")).toBe(100);
    expect(parseStoredVolumePct("-5")).toBe(0);
    expect(parseStoredVolumePct("loud")).toBe(100);
  });
});

describe("clampVolume", () => {
  it("clamps to the 0..1 gain range", () => {
    expect(clampVolume(0.4, 1)).toBe(0.4);
    expect(clampVolume(2, 0.5)).toBe(1);
    expect(clampVolume(-1, 0.5)).toBe(0);
  });

  it("keeps the current volume for non-finite values", () => {
    expect(clampVolume(Number.NaN, 0.3)).toBe(0.3);
    expect(clampVolume(Number.POSITIVE_INFINITY, 0.3)).toBe(0.3);
  });
});
