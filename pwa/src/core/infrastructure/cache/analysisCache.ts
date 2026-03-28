import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AnalysisOutput } from "@/shared/analysis-schema";

const DB_NAME = "forever-jukebox-pwa";
const STORE_NAME = "analysis";
let analysisDbPromise: Promise<IDBDatabase> | null = null;

type CacheBackend = AnalysisCachePort;
type TrackMetadata = {
  title: string;
  artist: string | null;
  durationSeconds: number | null;
};

export type CachedAnalysisTrack = TrackMetadata & {
  fingerprint: string;
  updatedAtEpochMs: number | null;
};

export function createAnalysisCache(): AnalysisCachePort {
  if (isOpfsAvailable()) {
    return new OpfsAnalysisCache();
  }
  return new IndexedDbAnalysisCache();
}

export async function getAnalysisCacheBytes(): Promise<number> {
  if (isOpfsAvailable()) {
    return getOpfsAnalysisBytes();
  }
  return getIndexedDbAnalysisBytes();
}

export async function clearAllAnalysisCache(): Promise<void> {
  if (isOpfsAvailable()) {
    await clearAllOpfsAnalysis();
    return;
  }
  await clearAllIndexedDbAnalysis();
}

export async function listCachedAnalysisTracks(): Promise<CachedAnalysisTrack[]> {
  if (isOpfsAvailable()) {
    return listOpfsAnalysisTracks();
  }
  return listIndexedDbAnalysisTracks();
}

export class MemoryAnalysisCache implements AnalysisCachePort {
  private store = new Map<string, AnalysisOutput>();

  async get(fingerprint: string) {
    return this.store.get(fingerprint) ?? null;
  }

  async set(fingerprint: string, analysis: AnalysisOutput) {
    this.store.set(fingerprint, analysis);
  }

  async clear(fingerprint: string) {
    this.store.delete(fingerprint);
  }
}

function isOpfsAvailable() {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function extractTrackMetadata(
  fingerprint: string,
  analysis: unknown,
): TrackMetadata {
  const track =
    analysis && typeof analysis === "object" && "track" in analysis
      ? (analysis as { track?: unknown }).track
      : null;
  const trackRecord =
    track && typeof track === "object" ? (track as Record<string, unknown>) : null;

  const title =
    asString(trackRecord?.title) ??
    `Cached track ${fingerprint.slice(0, 8)}`;
  const artist = asString(trackRecord?.artist);
  const durationSeconds = asFiniteNumber(trackRecord?.duration);

  return { title, artist, durationSeconds };
}

function sortCachedTracks(
  tracks: CachedAnalysisTrack[],
): CachedAnalysisTrack[] {
  return tracks.sort((a, b) => {
    const titleCompare = a.title.localeCompare(b.title, undefined, {
      sensitivity: "base",
    });
    if (titleCompare !== 0) {
      return titleCompare;
    }
    const artistA = a.artist ?? "";
    const artistB = b.artist ?? "";
    return artistA.localeCompare(artistB, undefined, {
      sensitivity: "base",
    });
  });
}

async function openAnalysisDb(): Promise<IDBDatabase> {
  if (!analysisDbPromise) {
    analysisDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
  }
  return analysisDbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openAnalysisDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function getOpfsAnalysisBytes(): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("analysis");
    const dirWithValues = dir as unknown as {
      values?: () => AsyncIterable<FileSystemHandle>;
    };
    if (typeof dirWithValues.values !== "function") {
      return 0;
    }
    let total = 0;
    for await (const handle of dirWithValues.values()) {
      if (handle.kind !== "file") {
        continue;
      }
      const file = await (handle as FileSystemFileHandle).getFile();
      total += file.size;
    }
    return total;
  } catch {
    return 0;
  }
}

async function clearAllOpfsAnalysis(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("analysis", { recursive: true });
  } catch {
    // ignore missing dir / unsupported clear
  }
}

async function listOpfsAnalysisTracks(): Promise<CachedAnalysisTrack[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("analysis");
    const dirWithValues = dir as unknown as {
      values?: () => AsyncIterable<FileSystemHandle>;
    };
    if (typeof dirWithValues.values !== "function") {
      return [];
    }
    const tracks: CachedAnalysisTrack[] = [];
    for await (const handle of dirWithValues.values()) {
      if (handle.kind !== "file" || !handle.name.endsWith(".json")) {
        continue;
      }
      try {
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const fingerprint = handle.name.replace(/\.json$/u, "");
        const metadata = extractTrackMetadata(fingerprint, parsed);
        tracks.push({
          fingerprint,
          ...metadata,
          updatedAtEpochMs: file.lastModified || null,
        });
      } catch {
        // Skip malformed entries.
      }
    }
    return sortCachedTracks(tracks);
  } catch {
    return [];
  }
}

async function getIndexedDbAnalysisBytes(): Promise<number> {
  try {
    const db = await openAnalysisDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      let totalBytes = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(totalBytes);
          return;
        }
        const serialized = JSON.stringify(cursor.value);
        totalBytes += new Blob([serialized]).size;
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
  } catch {
    return 0;
  }
}

async function clearAllIndexedDbAnalysis(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

async function listIndexedDbAnalysisTracks(): Promise<CachedAnalysisTrack[]> {
  try {
    const db = await openAnalysisDb();
    return await new Promise<CachedAnalysisTrack[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      const tracks: CachedAnalysisTrack[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(sortCachedTracks(tracks));
          return;
        }
        const fingerprint =
          typeof cursor.key === "string"
            ? cursor.key
            : String(cursor.key);
        const metadata = extractTrackMetadata(fingerprint, cursor.value as unknown);
        tracks.push({
          fingerprint,
          ...metadata,
          updatedAtEpochMs: null,
        });
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
  } catch {
    return [];
  }
}

class OpfsAnalysisCache implements CacheBackend {
  private dirPromise: Promise<FileSystemDirectoryHandle> | null = null;

  private async getDir() {
    if (!this.dirPromise) {
      this.dirPromise = (async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle("analysis", { create: true });
      })();
    }
    return this.dirPromise;
  }

  async get(fingerprint: string): Promise<AnalysisOutput | null> {
    try {
      const dir = await this.getDir();
      const handle = await dir.getFileHandle(`${fingerprint}.json`);
      const file = await handle.getFile();
      const text = await file.text();
      return JSON.parse(text) as AnalysisOutput;
    } catch {
      return null;
    }
  }

  async set(fingerprint: string, analysis: AnalysisOutput): Promise<void> {
    const dir = await this.getDir();
    const handle = await dir.getFileHandle(`${fingerprint}.json`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(analysis));
    await writable.close();
  }

  async clear(fingerprint: string): Promise<void> {
    try {
      const dir = await this.getDir();
      await dir.removeEntry(`${fingerprint}.json`);
    } catch {
      // ignore
    }
  }
}

class IndexedDbAnalysisCache implements CacheBackend {
  async get(fingerprint: string): Promise<AnalysisOutput | null> {
    try {
      const result = await withStore<AnalysisOutput | undefined>("readonly", (store) =>
        store.get(fingerprint)
      );
      return result ?? null;
    } catch {
      return null;
    }
  }

  async set(fingerprint: string, analysis: AnalysisOutput): Promise<void> {
    await withStore("readwrite", (store) => store.put(analysis, fingerprint));
  }

  async clear(fingerprint: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(fingerprint));
  }
}
