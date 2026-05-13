const trackCacheDbName = "forever-jukebox-cache";
const trackCacheStore = "tracks";
const appConfigStore = "app-config";

export type CachedTrack = {
  youtubeId: string;
  audio?: ArrayBuffer;
  jobId?: string;
  updatedAt: number;
};

let trackCacheDbPromise: Promise<IDBDatabase> | null = null;

function openTrackCacheDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (trackCacheDbPromise) {
    return trackCacheDbPromise;
  }
  trackCacheDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(trackCacheDbName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(trackCacheStore)) {
        db.createObjectStore(trackCacheStore, { keyPath: "youtubeId" });
      }
      if (!db.objectStoreNames.contains(appConfigStore)) {
        db.createObjectStore(appConfigStore, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return trackCacheDbPromise;
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
      resolve((request.result as CachedTrack | undefined) ?? null);
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
    youtubeId: trackId,
    audio: existing?.audio,
    jobId: existing?.jobId,
    updatedAt: Date.now(),
    ...patch,
  };
  const db = await openTrackCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readwrite");
    const store = tx.objectStore(trackCacheStore);
    const request = store.put(next);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB write failed"));
  });
}

export async function deleteCachedTrack(trackId: string) {
  const db = await openTrackCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readwrite");
    const store = tx.objectStore(trackCacheStore);
    const request = store.delete(trackId);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB delete failed"));
  });
}

export async function getCachedAudioBytes(): Promise<number> {
  const db = await openTrackCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readonly");
    const store = tx.objectStore(trackCacheStore);
    const request = store.openCursor();
    let totalBytes = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(totalBytes);
        return;
      }
      const value = cursor.value as CachedTrack;
      if (value?.audio instanceof ArrayBuffer) {
        totalBytes += value.audio.byteLength;
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

export async function clearCachedAudio() {
  const db = await openTrackCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readwrite");
    const store = tx.objectStore(trackCacheStore);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB clear failed"));
  });
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
