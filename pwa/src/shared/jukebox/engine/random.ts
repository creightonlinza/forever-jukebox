// Copied from web/src/engine/random.ts on 2026-02-11, reason: reuse RNG for jukebox branching.
export type RandomMode = "random" | "seeded" | "deterministic";

export function createRng(mode: RandomMode, seed?: number): () => number {
  if (mode === "random") {
    return Math.random;
  }
  let t = seed ?? 123456789;
  return function rng() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
