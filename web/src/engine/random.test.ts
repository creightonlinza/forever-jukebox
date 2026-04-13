import { describe, expect, it } from "vitest";
import { createRng } from "./random";

describe("createRng", () => {
  it("matches the seed-1337 golden sequence for seeded mode", () => {
    const rng = createRng("seeded", 1337);
    const actual = Array.from({ length: 5 }, () => rng());
    const expected = [
      0.1844118325971067,
      0.18998925131745636,
      0.8104719922412187,
      0.6437488221563399,
      0.430774615611881,
    ];

    expect(actual).toEqual(expected);
  });

  it("uses the same deterministic algorithm as seeded mode", () => {
    const seeded = createRng("seeded", 1337);
    const deterministic = createRng("deterministic", 1337);

    const seededValues = Array.from({ length: 8 }, () => seeded());
    const deterministicValues = Array.from({ length: 8 }, () => deterministic());

    expect(deterministicValues).toEqual(seededValues);
  });
});
