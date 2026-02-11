import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AnalysisOutput } from "@/shared/analysis-schema";

const DB_NAME = "forever-jukebox-pwa";
const STORE_NAME = "analysis";

type CacheBackend = AnalysisCachePort;

export function createAnalysisCache(): AnalysisCachePort {
  if (isOpfsAvailable()) {
    return new OpfsAnalysisCache();
  }
  return new IndexedDbAnalysisCache();
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
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
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
    return this.dbPromise;
  }

  private async withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.getDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }

  async get(fingerprint: string): Promise<AnalysisOutput | null> {
    try {
      const result = await this.withStore<AnalysisOutput | undefined>("readonly", (store) =>
        store.get(fingerprint)
      );
      return result ?? null;
    } catch {
      return null;
    }
  }

  async set(fingerprint: string, analysis: AnalysisOutput): Promise<void> {
    await this.withStore("readwrite", (store) => store.put(analysis, fingerprint));
  }

  async clear(fingerprint: string): Promise<void> {
    await this.withStore("readwrite", (store) => store.delete(fingerprint));
  }
}
