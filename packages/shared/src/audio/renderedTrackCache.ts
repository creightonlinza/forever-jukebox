import { canEncodeOpusWebm, decodeToStereo, encodeOpusWebm } from "./opusWebm";
import type { StereoChannels } from "./audioResample";

// Pre-rendered copies of a track (instrumental, swing), kept in Cache Storage
// under the track's id as WebM/Opus. Nothing is stored where the browser
// cannot encode it; the mode then renders each time.
export type RenderedTrackKind = "instrumental" | "swing";

export type RenderedTrackKey = {
  kind: RenderedTrackKind;
  trackId: string;
  // Identifies the render's inputs beyond the audio; a stored entry with a
  // different signature is ignored.
  signature?: string;
};

const TRACK_CACHE = "fj-rendered-tracks";
const TRACK_URL_PREFIX = "/rendered-track/";
const WEBM_TYPE = "audio/webm";
// Records the entry's size so listing sizes never reads a body.
const BYTES_HEADER = "x-fj-bytes";
const SIGNATURE_HEADER = "x-fj-signature";
const STORED_AT_HEADER = "x-fj-stored-at";
const KINDS: readonly RenderedTrackKind[] = ["instrumental", "swing"];
// Entries come back through the decoder a few frames off; anything
// further apart is a different recording under the same id.
const FRAME_TOLERANCE = 0.001;

function hasCacheStorage() {
  return typeof caches !== "undefined";
}

function trackUrl(kind: RenderedTrackKind, trackId: string) {
  return `${TRACK_URL_PREFIX}${kind}/${encodeURIComponent(trackId)}`;
}

// Null unless a render of `frames` frames at `sampleRate` with the key's
// signature is stored. Decoded channels come back at `sampleRate`.
export async function readRenderedTrack(
  { kind, trackId, signature = "" }: RenderedTrackKey,
  frames: number,
  sampleRate: number,
): Promise<StereoChannels | null> {
  if (!hasCacheStorage()) {
    return null;
  }
  const cache = await caches.open(TRACK_CACHE);
  const response = await cache.match(trackUrl(kind, trackId));
  if (!response) {
    return null;
  }
  if ((response.headers.get(SIGNATURE_HEADER) ?? "") !== signature) {
    return null;
  }
  const channels = await decodeToStereo(await response.arrayBuffer(), sampleRate);
  const tolerance = frames * FRAME_TOLERANCE + 1;
  return Math.abs(channels[0].length - frames) <= tolerance ? channels : null;
}

export async function writeRenderedTrack(
  { kind, trackId, signature = "" }: RenderedTrackKey,
  channels: StereoChannels,
  sampleRate: number,
) {
  if (!hasCacheStorage() || !(await canEncodeOpusWebm())) {
    return;
  }
  const body = await encodeOpusWebm(channels, sampleRate);
  const cache = await caches.open(TRACK_CACHE);
  await cache.put(
    trackUrl(kind, trackId),
    new Response(body, {
      headers: {
        "content-type": WEBM_TYPE,
        [BYTES_HEADER]: String(body.byteLength),
        [SIGNATURE_HEADER]: signature,
        [STORED_AT_HEADER]: String(Date.now()),
      },
    }),
  );
}

// Removes every rendered copy stored for the track.
export async function deleteRenderedTracks(trackId: string) {
  if (!hasCacheStorage()) {
    return;
  }
  const cache = await caches.open(TRACK_CACHE);
  for (const kind of KINDS) {
    await cache.delete(trackUrl(kind, trackId));
  }
}

type StoredTrack = { trackId: string; bytes: number; storedAt: number };

// One entry per track, covering all of its rendered copies. Entries without
// a recorded size are measured from their body.
async function listStoredTracks(): Promise<StoredTrack[]> {
  const tracks = new Map<string, StoredTrack>();
  if (!hasCacheStorage()) {
    return [];
  }
  const cache = await caches.open(TRACK_CACHE);
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) {
      continue;
    }
    const recorded = Number(response.headers.get(BYTES_HEADER));
    const bytes =
      Number.isFinite(recorded) && recorded > 0
        ? recorded
        : (await response.blob()).size;
    const storedAt = Number(response.headers.get(STORED_AT_HEADER)) || 0;
    const { pathname } = new URL(request.url, "http://localhost");
    const encodedId = pathname
      .slice(TRACK_URL_PREFIX.length)
      .replace(/^[^/]*\//, "");
    const trackId = decodeURIComponent(encodedId);
    const track = tracks.get(trackId) ?? { trackId, bytes: 0, storedAt: 0 };
    track.bytes += bytes;
    track.storedAt = Math.max(track.storedAt, storedAt);
    tracks.set(trackId, track);
  }
  return [...tracks.values()];
}

// Stored bytes of each track's rendered copies, by track id.
export async function listRenderedTrackBytes(): Promise<Map<string, number>> {
  const tracks = await listStoredTracks();
  return new Map(tracks.map((track) => [track.trackId, track.bytes]));
}

// Deletes the tracks stored longest ago until the total fits maxBytes;
// keepTrackId is never evicted.
export async function evictOldestRenderedTracks(
  maxBytes: number,
  keepTrackId: string | null,
) {
  const tracks = await listStoredTracks();
  let totalBytes = tracks.reduce((total, track) => total + track.bytes, 0);
  tracks.sort((a, b) => a.storedAt - b.storedAt);
  for (const track of tracks) {
    if (totalBytes <= maxBytes) {
      return;
    }
    if (track.trackId === keepTrackId) {
      continue;
    }
    await deleteRenderedTracks(track.trackId);
    totalBytes -= track.bytes;
  }
}

export async function getRenderedTrackBytes(): Promise<number> {
  let totalBytes = 0;
  for (const bytes of (await listRenderedTrackBytes()).values()) {
    totalBytes += bytes;
  }
  return totalBytes;
}

export async function clearRenderedTracks() {
  if (!hasCacheStorage()) {
    return;
  }
  await caches.delete(TRACK_CACHE);
}
