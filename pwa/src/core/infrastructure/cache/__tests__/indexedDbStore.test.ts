import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexedDbStore } from "../indexedDbStore";

type FakeTransaction = {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
};

// Minimal IndexedDB: the test decides when each transaction commits or aborts.
function stubIndexedDb() {
  const transactions: FakeTransaction[] = [];
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: FakeTransaction = { oncomplete: null, onerror: null, onabort: null, error: null };
      transactions.push(tx);
      return {
        ...tx,
        objectStore: () => ({ put: () => ({ result: "key" }) }),
        set oncomplete(fn: () => void) {
          tx.oncomplete = fn;
        },
        set onerror(fn: () => void) {
          tx.onerror = fn;
        },
        set onabort(fn: () => void) {
          tx.onabort = fn;
        },
        get error() {
          return tx.error;
        },
      };
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: { result: typeof db; onsuccess?: () => void } = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return transactions;
}

async function nextTransaction(transactions: FakeTransaction[]) {
  await vi.waitFor(() => expect(transactions.length).toBeGreaterThan(0));
  return transactions[transactions.length - 1]!;
}

describe("createIndexedDbStore", () => {
  let transactions: FakeTransaction[];

  beforeEach(() => {
    transactions = stubIndexedDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a write only once its transaction commits", async () => {
    const store = createIndexedDbStore("db", "store");
    const write = store.run("readwrite", (objectStore) => objectStore.put("value", "key"));
    const settled = vi.fn();
    void write.then(settled);

    const tx = await nextTransaction(transactions);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    tx.oncomplete?.();
    await expect(write).resolves.toBe("key");
  });

  it("rejects a write whose transaction aborts", async () => {
    const store = createIndexedDbStore("db", "store");
    const write = store.run("readwrite", (objectStore) => objectStore.put("value", "key"));

    const tx = await nextTransaction(transactions);
    tx.error = new Error("quota exceeded");
    tx.onabort?.();

    await expect(write).rejects.toThrow("quota exceeded");
  });
});
