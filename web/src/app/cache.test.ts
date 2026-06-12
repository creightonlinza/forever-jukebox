import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowUrl } from "./__tests__/test-utils";

type RequestHandler = () => void;

class MockRequest<T = unknown> {
  result: T | null = null;
  error: Error | null = null;
  onsuccess: RequestHandler | null = null;
  onerror: RequestHandler | null = null;
  onupgradeneeded: RequestHandler | null = null;
}

class MockStore {
  constructor(private store: Map<string, unknown>) {}

  get(key: string) {
    const request = new MockRequest();
    queueMicrotask(() => {
      request.result = this.store.get(key) ?? null;
      request.onsuccess?.();
    });
    return request;
  }

  put(value: { trackId?: string; youtubeId?: string; key?: string }) {
    const request = new MockRequest();
    queueMicrotask(() => {
      const storeKey = value.youtubeId ?? value.key;
      if (storeKey) {
        this.store.set(storeKey, value);
        request.onsuccess?.();
      } else {
        request.error = new Error("Missing key");
        request.onerror?.();
      }
    });
    return request;
  }

  delete(key: string) {
    const request = new MockRequest();
    queueMicrotask(() => {
      this.store.delete(key);
      request.onsuccess?.();
    });
    return request;
  }

  clear() {
    const request = new MockRequest();
    queueMicrotask(() => {
      this.store.clear();
      request.onsuccess?.();
    });
    return request;
  }

  openCursor() {
    const request = new MockRequest();
    const entries = Array.from(this.store.values());
    let index = 0;
    const makeCursor = () => ({
      value: entries[index],
      continue: () => {
        index += 1;
        queueMicrotask(() => {
          if (index >= entries.length) {
            request.result = null;
          } else {
            request.result = makeCursor();
          }
          request.onsuccess?.();
        });
      },
    });
    queueMicrotask(() => {
      request.result = entries.length > 0 ? makeCursor() : null;
      request.onsuccess?.();
    });
    return request;
  }
}

class MockDb {
  version = 1;
  private storeNames = new Set<string>();
  objectStoreNames = {
    contains: (name: string) => this.storeNames.has(name),
  };
  private stores = new Map<string, Map<string, unknown>>();

  createObjectStore(name: string) {
    this.storeNames.add(name);
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
  }

  transaction(name: string) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return {
      objectStore: (storeName: string) => {
        if (!this.stores.has(storeName)) {
          this.stores.set(storeName, new Map());
        }
        return new MockStore(this.stores.get(storeName) ?? new Map());
      },
    };
  }
}

function createIndexedDb() {
  const dbs = new Map<string, MockDb>();
  return {
    open: (name: string, version: number) => {
      const request = new MockRequest<MockDb>();
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) {
          db = new MockDb();
          dbs.set(name, db);
        }
        if (db.version < version) {
          db.version = version;
          request.result = db;
          request.onupgradeneeded?.();
        }
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
}

describe("cache", () => {
  beforeEach(async () => {
    vi.resetModules();
    setWindowUrl("http://localhost/");
    (globalThis.window as any).indexedDB = createIndexedDb();
  });

  it("rejects when IndexedDB is unavailable", async () => {
    delete (globalThis.window as any).indexedDB;
    const { readCachedTrack } = await import("./cache");
    await expect(readCachedTrack("abc")).rejects.toThrow(
      "IndexedDB not available",
    );
  });

  it("reads and writes cached tracks", async () => {
    const { readCachedTrack, updateCachedTrack } = await import("./cache");
    await updateCachedTrack("abc", { jobId: "job1" });
    const cached = await readCachedTrack("abc");
    expect(cached?.trackId).toBe("abc");
    expect(cached?.jobId).toBe("job1");
  });

  it("deletes cached tracks", async () => {
    const { deleteCachedTrack, readCachedTrack, updateCachedTrack } =
      await import("./cache");
    await updateCachedTrack("abc", { jobId: "job1" });
    await deleteCachedTrack("abc");
    const cached = await readCachedTrack("abc");
    expect(cached).toBeNull();
  });

  it("saves and loads app config", async () => {
    const { loadAppConfig, saveAppConfig } = await import("./cache");
    await saveAppConfig({ theme: "light" });
    const config = await loadAppConfig();
    expect(config).toEqual({ theme: "light" });
  });

  it("reports cached audio size and clears tracks", async () => {
    const {
      getCachedAudioBytes,
      clearCachedAudio,
      updateCachedTrack,
      readCachedTrack,
      loadAppConfig,
      saveAppConfig,
    } = await import("./cache");
    await updateCachedTrack("abc", { audio: new ArrayBuffer(1024) });
    await updateCachedTrack("def", { audio: new ArrayBuffer(2048) });
    await saveAppConfig({ theme: "dark" });
    expect(await getCachedAudioBytes()).toBe(3072);
    await clearCachedAudio();
    expect(await getCachedAudioBytes()).toBe(0);
    expect(await readCachedTrack("abc")).toBeNull();
    expect(await loadAppConfig()).toEqual({ theme: "dark" });
  });
});
