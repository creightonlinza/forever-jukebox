import { canEncodeOpusWebm, decodeToStereo, encodeOpusWebm } from "./opusWebm";
import type { StereoChannels } from "./audioResample";

// Rendered instrumentals, kept in Cache Storage. New entries are WebM/Opus
// where the browser can encode it; otherwise 16-bit stereo PCM at the
// separator's sample rate, left channel followed by right.
const TRACK_CACHE = "fj-instrumental-tracks";
const TRACK_URL_PREFIX = "/instrumental-track/";
const WEBM_TYPE = "audio/webm";
const PCM_TYPE = "application/octet-stream";
const BYTES_PER_FRAME = 4;
const INT16_SCALE = 32_767;
// Lossy entries come back through the decoder a few frames off; anything
// further apart is a different recording under the same id.
const FRAME_TOLERANCE = 0.001;

function hasCacheStorage() {
  return typeof caches !== "undefined";
}

function trackUrl(trackId: string) {
  return `${TRACK_URL_PREFIX}${encodeURIComponent(trackId)}`;
}

export function encodeInstrumentalTrack([
  left,
  right,
]: StereoChannels): ArrayBuffer {
  const frames = Math.min(left.length, right.length);
  const encoded = new Int16Array(frames * 2);
  for (let idx = 0; idx < frames; idx += 1) {
    encoded[idx] = Math.round(
      Math.max(-1, Math.min(1, left[idx])) * INT16_SCALE,
    );
    encoded[frames + idx] = Math.round(
      Math.max(-1, Math.min(1, right[idx])) * INT16_SCALE,
    );
  }
  return encoded.buffer;
}

export function decodeInstrumentalTrack(
  bytes: ArrayBuffer,
): StereoChannels {
  const frames = Math.floor(bytes.byteLength / BYTES_PER_FRAME);
  const encoded = new Int16Array(bytes, 0, frames * 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let idx = 0; idx < frames; idx += 1) {
    left[idx] = encoded[idx] / INT16_SCALE;
    right[idx] = encoded[frames + idx] / INT16_SCALE;
  }
  return [left, right];
}

// Null unless a render of `frames` frames at `sampleRate` is stored for the
// track. Decoded channels come back at `sampleRate`.
export async function readInstrumentalTrack(
  trackId: string,
  frames: number,
  sampleRate: number,
): Promise<StereoChannels | null> {
  if (!hasCacheStorage()) {
    return null;
  }
  const cache = await caches.open(TRACK_CACHE);
  const response = await cache.match(trackUrl(trackId));
  if (!response) {
    return null;
  }
  const bytes = await response.arrayBuffer();
  if (response.headers.get("content-type") === WEBM_TYPE) {
    const channels = await decodeToStereo(bytes, sampleRate);
    const tolerance = frames * FRAME_TOLERANCE + 1;
    return Math.abs(channels[0].length - frames) <= tolerance ? channels : null;
  }
  if (bytes.byteLength !== frames * BYTES_PER_FRAME) {
    return null;
  }
  return decodeInstrumentalTrack(bytes);
}

// Null when the browser cannot encode Opus, or the encoder fails; the
// caller then stores PCM instead.
async function encodeWebmOrNull(channels: StereoChannels, sampleRate: number) {
  if (!(await canEncodeOpusWebm())) {
    return null;
  }
  try {
    return await encodeOpusWebm(channels, sampleRate);
  } catch (err) {
    console.warn(`Instrumental Opus encode failed: ${String(err)}`);
    return null;
  }
}

export async function writeInstrumentalTrack(
  trackId: string,
  channels: StereoChannels,
  sampleRate: number,
) {
  if (!hasCacheStorage()) {
    return;
  }
  const webm = await encodeWebmOrNull(channels, sampleRate);
  const cache = await caches.open(TRACK_CACHE);
  // Unbounded, like the cached track audio; the browser evicts under pressure.
  await cache.put(
    trackUrl(trackId),
    new Response(webm ?? encodeInstrumentalTrack(channels), {
      headers: { "content-type": webm ? WEBM_TYPE : PCM_TYPE },
    }),
  );
}

export async function deleteInstrumentalTrack(trackId: string) {
  if (!hasCacheStorage()) {
    return;
  }
  const cache = await caches.open(TRACK_CACHE);
  await cache.delete(trackUrl(trackId));
}

export async function getInstrumentalTrackBytes(): Promise<number> {
  if (!hasCacheStorage()) {
    return 0;
  }
  const cache = await caches.open(TRACK_CACHE);
  let totalBytes = 0;
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    totalBytes += (await response?.blob())?.size ?? 0;
  }
  return totalBytes;
}

export async function clearInstrumentalTracks() {
  if (!hasCacheStorage()) {
    return;
  }
  await caches.delete(TRACK_CACHE);
}
