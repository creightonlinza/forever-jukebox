import {
  clearInstrumentalTracks,
  deleteInstrumentalTrack,
  listInstrumentalTrackBytes,
} from "@forever-jukebox/shared/audio/instrumentalTrackCache";

const trackCacheDbName = "forever-jukebox-cache";
const trackCacheStore = "tracks";
const trackMetaStore = "track-meta";
const appConfigStore = "app-config";
const maxCachedAudioBytes = 500 * 1024 * 1024;

export type CachedTrack = {
  trackId: string;
  // Previous IndexedDB keyPath. Keep writing this until the object store is migrated.
  youtubeId: string;
  audio?: ArrayBuffer;
  jobId?: string;
  updatedAt: number;
};

// Size and last-used time of each cached track, stored apart from the audio so
// eviction never loads buffers. Listings add the track's stored instrumental.
type CachedTrackMeta = { trackId: string; bytes: number; updatedAt: number };

let trackCacheDbPromise: Promise<IDBDatabase> | null = null;

function openTrackCacheDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (trackCacheDbPromise) {
    return trackCacheDbPromise;
  }
  trackCacheDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(trackCacheDbName, 3);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(trackCacheStore)) {
        db.createObjectStore(trackCacheStore, { keyPath: "youtubeId" });
      }
      if (!db.objectStoreNames.contains(trackMetaStore)) {
        db.createObjectStore(trackMetaStore, { keyPath: "trackId" });
      }
      if (!db.objectStoreNames.contains(appConfigStore)) {
        db.createObjectStore(appConfigStore, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      // Release the connection so another tab's schema upgrade is not blocked.
      db.onversionchange = () => {
        db.close();
        trackCacheDbPromise = null;
      };
      resolve(db);
    };
    // Another tab holds an older schema open. Fail fast so callers fall back
    // to the network; the next call retries.
    request.onblocked = () => {
      blocked = true;
      trackCacheDbPromise = null;
      reject(new Error("IndexedDB upgrade blocked"));
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return trackCacheDbPromise;
}

async function openTrackTransaction(mode: IDBTransactionMode) {
  const db = await openTrackCacheDb();
  const tx = db.transaction([trackCacheStore, trackMetaStore], mode);
  // Quota failures can surface at commit, so settle on the transaction.
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
  return {
    tracks: tx.objectStore(trackCacheStore),
    meta: tx.objectStore(trackMetaStore),
    done,
  };
}

function sumBytes(entries: CachedTrackMeta[]) {
  return entries.reduce((total, entry) => total + entry.bytes, 0);
}

export async function readCachedTrack(
  trackId: string
): Promise<CachedTrack | null> {
  const db = await openTrackCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readonly");
    const store = tx.objectStore(trackCacheStore);
    const request = store.get(trackId);
    request.onsuccess = () => {
      const result = request.result as
        | (Partial<CachedTrack> & { youtubeId?: string })
        | undefined;
      if (!result) {
        resolve(null);
        return;
      }
      const normalizedTrackId = result.trackId ?? result.youtubeId ?? trackId;
      resolve({
        trackId: normalizedTrackId,
        youtubeId: result.youtubeId ?? normalizedTrackId,
        audio: result.audio,
        jobId: result.jobId,
        updatedAt: result.updatedAt ?? 0,
      });
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

export async function updateCachedTrack(
  trackId: string,
  patch: Partial<CachedTrack>
) {
  const existing = await readCachedTrack(trackId);
  const next: CachedTrack = {
    trackId,
    youtubeId: trackId,
    audio: existing?.audio,
    jobId: existing?.jobId,
    updatedAt: Date.now(),
    ...patch,
  };
  const audio = patch.audio;
  if (!audio) {
    await putCachedTrack(next);
    return;
  }
  try {
    await putCachedTrack(next);
  } catch (err) {
    if (!(await isQuotaError(err, audio.byteLength))) {
      throw err;
    }
    const entries = await listCachedAudioEntries();
    const otherBytes = sumBytes(
      entries.filter((entry) => entry.trackId !== trackId),
    );
    // Evicting only helps when the rest of the cache can make room for this buffer.
    if (otherBytes < audio.byteLength) {
      throw err;
    }
    await evictOldestAudio(sumBytes(entries) - audio.byteLength, trackId);
    await putCachedTrack(next);
  }
  try {
    await evictOldestAudio(maxCachedAudioBytes, trackId);
  } catch (err) {
    console.warn(`Cache eviction failed: ${String(err)}`);
  }
}

async function isQuotaError(err: unknown, neededBytes: number) {
  if ((err as { name?: string } | null)?.name === "QuotaExceededError") {
    return true;
  }
  // Some browsers report a full disk under another error name.
  try {
    const estimate = await navigator.storage?.estimate?.();
    return (
      estimate?.quota !== undefined &&
      estimate.usage !== undefined &&
      estimate.quota - estimate.usage < neededBytes
    );
  } catch {
    return false;
  }
}

function metaFor(track: Partial<CachedTrack>, trackId: string): CachedTrackMeta {
  return {
    trackId,
    bytes: track.audio instanceof ArrayBuffer ? track.audio.byteLength : 0,
    updatedAt: track.updatedAt ?? 0,
  };
}

async function putCachedTrack(track: CachedTrack) {
  const { tracks, meta, done } = await openTrackTransaction("readwrite");
  tracks.put(track);
  meta.put(metaFor(track, track.trackId));
  await done;
}

// Marks a cached track as recently used. bytes is the size of its audio.
export async function touchCachedTrack(trackId: string, bytes: number) {
  const { tracks, meta, done } = await openTrackTransaction("readwrite");
  const request = tracks.getKey(trackId);
  request.onsuccess = () => {
    if (request.result !== undefined) {
      meta.put({ trackId, bytes, updatedAt: Date.now() });
    }
  };
  await done;
}

// Moves cached audio to a new id. Resolves false when fromId has no audio.
export async function moveCachedTrack(
  fromId: string,
  toId: string
): Promise<boolean> {
  const { tracks, meta, done } = await openTrackTransaction("readwrite");
  let moved = false;
  const request = tracks.get(fromId);
  request.onsuccess = () => {
    const cached = request.result as Partial<CachedTrack> | undefined;
    if (!cached?.audio) {
      return;
    }
    const next: CachedTrack = {
      trackId: toId,
      youtubeId: toId,
      audio: cached.audio,
      jobId: cached.jobId ?? toId,
      updatedAt: Date.now(),
    };
    tracks.put(next);
    meta.put(metaFor(next, toId));
    tracks.delete(fromId);
    meta.delete(fromId);
    moved = true;
  };
  await done;
  if (moved) {
    // The stored instrumental is keyed by the old id; the new id renders again.
    await deleteInstrumentalTrack(fromId).catch((err: unknown) => {
      console.warn(`Instrumental cache delete failed: ${String(err)}`);
    });
  }
  return moved;
}

// Removes the track's audio and its stored instrumental. Cache Storage
// failures are logged so they never block the audio removal.
export async function deleteCachedTrack(trackId: string) {
  await deleteInstrumentalTrack(trackId).catch((err: unknown) => {
    console.warn(`Instrumental cache delete failed: ${String(err)}`);
  });
  const { tracks, meta, done } = await openTrackTransaction("readwrite");
  tracks.delete(trackId);
  meta.delete(trackId);
  await done;
}

async function listCachedAudioEntries(): Promise<CachedTrackMeta[]> {
  const { tracks, meta, done } = await openTrackTransaction("readonly");
  const keysRequest = tracks.getAllKeys();
  const metaRequest = meta.getAll();
  await done;
  const entries = metaRequest.result as CachedTrackMeta[];
  const known = new Set(entries.map((entry) => entry.trackId));
  // Tracks without a meta record are measured once, on first listing.
  for (const key of keysRequest.result) {
    const trackId = String(key);
    if (known.has(trackId)) {
      continue;
    }
    const backfilled = await backfillTrackMeta(trackId);
    if (backfilled) {
      entries.push(backfilled);
    }
  }
  return withInstrumentalBytes(entries);
}

// A track's stored instrumental shares its id, so it counts toward the track's
// size and is evicted with it. One without cached audio is listed as oldest.
async function withInstrumentalBytes(
  entries: CachedTrackMeta[]
): Promise<CachedTrackMeta[]> {
  const instrumentals = await listInstrumentalTrackBytes().catch(
    () => new Map<string, number>(),
  );
  const merged = entries.map((entry) => {
    const bytes = entry.bytes + (instrumentals.get(entry.trackId) ?? 0);
    instrumentals.delete(entry.trackId);
    return { ...entry, bytes };
  });
  for (const [trackId, bytes] of instrumentals) {
    merged.push({ trackId, bytes, updatedAt: 0 });
  }
  return merged;
}

async function backfillTrackMeta(
  trackId: string
): Promise<CachedTrackMeta | null> {
  const { tracks, meta, done } = await openTrackTransaction("readwrite");
  let entry: CachedTrackMeta | null = null;
  const request = tracks.get(trackId);
  request.onsuccess = () => {
    const cached = request.result as Partial<CachedTrack> | undefined;
    if (!cached) {
      return;
    }
    entry = metaFor(cached, trackId);
    meta.put(entry);
  };
  await done;
  return entry;
}

// Covers cached track audio and stored instrumentals.
export async function getCachedAudioBytes(): Promise<number> {
  return sumBytes(await listCachedAudioEntries());
}

// Deletes least-recently-used audio until the total fits maxBytes; keepId is
// never evicted.
async function evictOldestAudio(maxBytes: number, keepId: string) {
  const entries = await listCachedAudioEntries();
  let totalBytes = sumBytes(entries);
  entries.sort((a, b) => a.updatedAt - b.updatedAt);
  for (const entry of entries) {
    if (totalBytes <= maxBytes) {
      return;
    }
    if (entry.trackId === keepId || entry.bytes === 0) {
      continue;
    }
    await deleteCachedTrack(entry.trackId);
    totalBytes -= entry.bytes;
  }
}

export async function clearCachedAudio() {
  await clearInstrumentalTracks().catch((err: unknown) => {
    console.warn(`Instrumental cache clear failed: ${String(err)}`);
  });
  const { tracks, meta, done } = await openTrackTransaction("readwrite");
  tracks.clear();
  meta.clear();
  await done;
}

export async function saveAppConfig(value: unknown) {
  const db = await openTrackCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(appConfigStore, "readwrite");
    const store = tx.objectStore(appConfigStore);
    const request = store.put({ key: "app-config", value, updatedAt: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB write failed"));
  });
}

export async function loadAppConfig(): Promise<unknown | null> {
  const db = await openTrackCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(appConfigStore, "readonly");
    const store = tx.objectStore(appConfigStore);
    const request = store.get("app-config");
    request.onsuccess = () => {
      const value = request.result?.value ?? null;
      resolve(value);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
  });
}
