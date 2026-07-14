import { DEFAULT_SWING_AMOUNT } from "./swingTiming";

type CacheEntry = AudioBuffer | Promise<AudioBuffer>;

const identityCache = new Map<string, CacheEntry>();
const sourceBufferCache = new WeakMap<AudioBuffer, Map<string, CacheEntry>>();

export function getSwingBufferCacheKey(
  sourceBuffer: AudioBuffer,
  sourceIdentity: string | null,
  swingAmount = DEFAULT_SWING_AMOUNT,
): string {
  return [
    sourceIdentity ?? "buffer",
    "swing",
    swingAmount,
    sourceBuffer.sampleRate,
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
  ].join(":");
}

export function getOrCreateSwingBuffer(
  sourceBuffer: AudioBuffer,
  sourceIdentity: string | null,
  render: () => Promise<AudioBuffer>,
  swingAmount = DEFAULT_SWING_AMOUNT,
): Promise<AudioBuffer> {
  const cacheKey = getSwingBufferCacheKey(
    sourceBuffer,
    sourceIdentity,
    swingAmount,
  );
  const cache = getCache(sourceBuffer, sourceIdentity);
  const existing = cache.get(cacheKey);
  if (existing) {
    return Promise.resolve(existing);
  }
  const pending = render()
    .then((buffer) => {
      cache.set(cacheKey, buffer);
      return buffer;
    })
    .catch((err: unknown) => {
      cache.delete(cacheKey);
      throw err;
    });
  cache.set(cacheKey, pending);
  return pending;
}

function getCache(
  sourceBuffer: AudioBuffer,
  sourceIdentity: string | null,
): Map<string, CacheEntry> {
  if (sourceIdentity) {
    return identityCache;
  }
  let cache = sourceBufferCache.get(sourceBuffer);
  if (!cache) {
    cache = new Map<string, CacheEntry>();
    sourceBufferCache.set(sourceBuffer, cache);
  }
  return cache;
}
