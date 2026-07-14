export type RandomMode = "random" | "seeded" | "deterministic";

const DEFAULT_SEED = 123456789;
const MIX_CONSTANT = 0x6d2b79f5;
const MASK_32 = 0xffffffff;
const UINT32_RANGE = 4294967296;

export function createRng(mode: RandomMode, seed?: number): () => number {
  if (mode === "random") {
    return Math.random;
  }
  let t = seed ?? DEFAULT_SEED;
  return function rng() {
    t += MIX_CONSTANT;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return (((x ^ (x >>> 14)) >>> 0) % (MASK_32 + 1)) / UINT32_RANGE;
  };
}
