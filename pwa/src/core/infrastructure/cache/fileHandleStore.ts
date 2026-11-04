// Handles to the audio files behind cached analyses, keyed by fingerprint, so
// a cached track can reopen its file without copying the audio. Kept in its
// own database so the analysis database's schema stays untouched.
const DB_NAME = "forever-jukebox-pwa-handles";
const STORE_NAME = "handles";
let handleDbPromise: Promise<IDBDatabase> | null = null;

function openHandleDb(): Promise<IDBDatabase> {
  handleDbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  }).catch((err: unknown) => {
    handleDbPromise = null;
    throw err;
  });
  return handleDbPromise;
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openHandleDb();
  return new Promise<T>((resolve, reject) => {
    const request = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

export async function getFileHandle(
  fingerprint: string,
): Promise<FileSystemFileHandle | null> {
  if (!hasIndexedDb()) {
    return null;
  }
  const handle = await withHandleStore<FileSystemFileHandle | undefined>(
    "readonly",
    (store) => store.get(fingerprint),
  );
  return handle ?? null;
}

export async function setFileHandle(
  fingerprint: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }
  await withHandleStore("readwrite", (store) => store.put(handle, fingerprint));
}

export async function deleteFileHandle(fingerprint: string): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }
  await withHandleStore("readwrite", (store) => store.delete(fingerprint));
}

export async function clearFileHandles(): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }
  await withHandleStore("readwrite", (store) => store.clear());
}

// The handle's file, asking for read access when the browser no longer holds
// it (needs the user's click). Null when access is refused or the file is gone.
export async function readFileFromHandle(
  handle: FileSystemFileHandle,
): Promise<File | null> {
  try {
    const descriptor = { mode: "read" } as const;
    if (handle.queryPermission && (await handle.queryPermission(descriptor)) !== "granted") {
      if (
        !handle.requestPermission ||
        (await handle.requestPermission(descriptor)) !== "granted"
      ) {
        return null;
      }
    }
    return await handle.getFile();
  } catch {
    return null;
  }
}
