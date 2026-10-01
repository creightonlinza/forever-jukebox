import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowUrl } from "./__tests__/test-utils";

type RequestHandler = () => void;

class MockRequest<T = unknown> {
  result: T | null | undefined = null;
  error: Error | null = null;
  onsuccess: RequestHandler | null = null;
  onerror: RequestHandler | null = null;
  onupgradeneeded: RequestHandler | null = null;
  onblocked: RequestHandler | null = null;
}

type StoreData = { keyPath: string; records: Map<string, unknown> };

class MockTransaction {
  error: Error | null = null;
  oncomplete: RequestHandler | null = null;
  onabort: RequestHandler | null = null;
  private pending = 0;
  private settled = false;

  constructor(
    private db: MockDb,
    private mode: string,
  ) {}

  objectStore(name: string) {
    return new MockStore(this.db.storeData(name), this, name);
  }

  // Runs a request, then completes the transaction once no requests remain.
  run<T>(work: () => T): MockRequest<T> {
    const request = new MockRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.settled) {
        return;
      }
      try {
        request.result = work();
        request.onsuccess?.();
      } catch (err) {
        request.error = err as Error;
        request.onerror?.();
        this.settled = true;
        this.error = err as Error;
        this.onabort?.();
        return;
      }
      this.pending -= 1;
      queueMicrotask(() => {
        if (this.pending === 0 && !this.settled) {
          this.settled = true;
          this.oncomplete?.();
        }
      });
    });
    return request;
  }

  takePutFailure(storeName: string): Error | null {
    if (this.mode !== "readwrite") {
      return null;
    }
    return this.db.takePutFailure(storeName);
  }
}

class MockStore {
  constructor(
    private data: StoreData,
    private tx: MockTransaction,
    private name: string,
  ) {}

  get(key: string) {
    return this.tx.run(() => this.data.records.get(key));
  }

  getKey(key: string) {
    return this.tx.run(() => (this.data.records.has(key) ? key : undefined));
  }

  getAllKeys() {
    return this.tx.run(() => Array.from(this.data.records.keys()));
  }

  getAll() {
    return this.tx.run(() => Array.from(this.data.records.values()));
  }

  put(value: Record<string, unknown>) {
    return this.tx.run(() => {
      const failure = this.tx.takePutFailure(this.name);
      if (failure) {
        throw failure;
      }
      const storeKey = value[this.data.keyPath];
      if (typeof storeKey !== "string") {
        throw new Error("Missing key");
      }
      this.data.records.set(storeKey, value);
    });
  }

  delete(key: string) {
    return this.tx.run(() => {
      this.data.records.delete(key);
    });
  }

  clear() {
    return this.tx.run(() => {
      this.data.records.clear();
    });
  }
}

class MockDb {
  version = 1;
  putFailures = new Map<string, Error>();
  private stores = new Map<string, StoreData>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string, options: { keyPath: string }) {
    this.stores.set(name, { keyPath: options.keyPath, records: new Map() });
  }

  storeData(name: string): StoreData {
    const data = this.stores.get(name);
    if (!data) {
      throw new Error(`Unknown store ${name}`);
    }
    return data;
  }

  takePutFailure(storeName: string): Error | null {
    const failure = this.putFailures.get(storeName) ?? null;
    this.putFailures.delete(storeName);
    return failure;
  }

  transaction(_names: string | string[], mode = "readonly") {
    return new MockTransaction(this, mode);
  }

  close() {}
}

function createIndexedDb() {
  const dbs = new Map<string, MockDb>();
  return {
    dbs,
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

const mb = 1024 * 1024;

function cacheDb(): MockDb {
  const db = (globalThis.window as any).indexedDB.dbs.get(
    "forever-jukebox-cache",
  );
  return db as MockDb;
}

function quotaError() {
  const error = new Error("full");
  error.name = "QuotaExceededError";
  return error;
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

  it("evicts least-recently-used audio beyond the cap", async () => {
    const {
      getCachedAudioBytes,
      readCachedTrack,
      touchCachedTrack,
      updateCachedTrack,
    } = await import("./cache");
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1);
    await updateCachedTrack("old", { audio: new ArrayBuffer(200 * mb) });
    now.mockReturnValue(2);
    await updateCachedTrack("mid", { audio: new ArrayBuffer(200 * mb) });
    now.mockReturnValue(3);
    await touchCachedTrack("old", 200 * mb);
    now.mockReturnValue(4);
    await updateCachedTrack("new", { audio: new ArrayBuffer(200 * mb) });
    now.mockRestore();

    expect(await readCachedTrack("mid")).toBeNull();
    expect((await readCachedTrack("old"))?.audio).toBeDefined();
    expect((await readCachedTrack("new"))?.audio).toBeDefined();
    expect(await getCachedAudioBytes()).toBe(400 * mb);
  });

  it("measures tracks that have no meta record and evicts them first", async () => {
    const { getCachedAudioBytes, readCachedTrack, updateCachedTrack } =
      await import("./cache");
    await updateCachedTrack("recent", { audio: new ArrayBuffer(200 * mb) });
    cacheDb()
      .storeData("tracks")
      .records.set("legacy", {
        youtubeId: "legacy",
        audio: new ArrayBuffer(200 * mb),
      });
    expect(await getCachedAudioBytes()).toBe(400 * mb);
    expect(cacheDb().storeData("track-meta").records.get("legacy")).toEqual({
      trackId: "legacy",
      bytes: 200 * mb,
      updatedAt: 0,
    });

    await updateCachedTrack("new", { audio: new ArrayBuffer(200 * mb) });
    expect(await readCachedTrack("legacy")).toBeNull();
    expect((await readCachedTrack("recent"))?.audio).toBeDefined();
  });

  it("does not recreate a deleted track when touched", async () => {
    const {
      deleteCachedTrack,
      getCachedAudioBytes,
      readCachedTrack,
      touchCachedTrack,
      updateCachedTrack,
    } = await import("./cache");
    await updateCachedTrack("abc", { audio: new ArrayBuffer(1024) });
    await deleteCachedTrack("abc");
    await touchCachedTrack("abc", 1024);
    expect(await readCachedTrack("abc")).toBeNull();
    expect(await getCachedAudioBytes()).toBe(0);
  });

  it("moves cached audio to a new id without evicting", async () => {
    const {
      getCachedAudioBytes,
      moveCachedTrack,
      readCachedTrack,
      updateCachedTrack,
    } = await import("./cache");
    await updateCachedTrack("other", { audio: new ArrayBuffer(300 * mb) });
    await updateCachedTrack("from", { audio: new ArrayBuffer(200 * mb) });

    expect(await moveCachedTrack("from", "to")).toBe(true);
    expect(await readCachedTrack("from")).toBeNull();
    const moved = await readCachedTrack("to");
    expect(moved?.audio?.byteLength).toBe(200 * mb);
    expect(moved?.jobId).toBe("to");
    expect((await readCachedTrack("other"))?.audio).toBeDefined();
    expect(await getCachedAudioBytes()).toBe(500 * mb);
    expect(await moveCachedTrack("missing", "to")).toBe(false);
  });

  it("evicts and retries once when a write hits the quota", async () => {
    const { readCachedTrack, updateCachedTrack } = await import("./cache");
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1);
    await updateCachedTrack("old", { audio: new ArrayBuffer(4096) });
    now.mockReturnValue(2);
    await updateCachedTrack("mid", { audio: new ArrayBuffer(4096) });
    now.mockReturnValue(3);
    cacheDb().putFailures.set("tracks", quotaError());
    await updateCachedTrack("new", { audio: new ArrayBuffer(2048) });
    now.mockRestore();

    expect(await readCachedTrack("old")).toBeNull();
    expect((await readCachedTrack("mid"))?.audio).toBeDefined();
    expect((await readCachedTrack("new"))?.audio).toBeDefined();
  });

  it("keeps the cache when evicting cannot make room", async () => {
    const { readCachedTrack, updateCachedTrack } = await import("./cache");
    await updateCachedTrack("small", { audio: new ArrayBuffer(1024) });
    cacheDb().putFailures.set("tracks", quotaError());
    await expect(
      updateCachedTrack("big", { audio: new ArrayBuffer(4096) }),
    ).rejects.toThrow("full");
    expect((await readCachedTrack("small"))?.audio).toBeDefined();
    expect(await readCachedTrack("big")).toBeNull();
  });

  it("does not evict on a non-quota write failure", async () => {
    const { readCachedTrack, updateCachedTrack } = await import("./cache");
    await updateCachedTrack("old", { audio: new ArrayBuffer(4096) });
    cacheDb().putFailures.set("tracks", new Error("boom"));
    await expect(
      updateCachedTrack("new", { audio: new ArrayBuffer(1024) }),
    ).rejects.toThrow("boom");
    expect((await readCachedTrack("old"))?.audio).toBeDefined();
  });
});
