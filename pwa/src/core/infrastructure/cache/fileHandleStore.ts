import { createIndexedDbStore } from "./indexedDbStore";

// Handles to the audio files behind cached analyses, keyed by fingerprint, so
// a cached track can reopen its file without copying the audio. Kept in its
// own database so the analysis database's schema stays untouched.
const handleDb = createIndexedDbStore("forever-jukebox-pwa-handles", "handles");

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

export async function getFileHandle(
  fingerprint: string,
): Promise<FileSystemFileHandle | null> {
  if (!hasIndexedDb()) {
    return null;
  }
  const handle = await handleDb.run<FileSystemFileHandle | undefined>(
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
  await handleDb.run("readwrite", (store) => store.put(handle, fingerprint));
}

export async function deleteFileHandle(fingerprint: string): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }
  await handleDb.run("readwrite", (store) => store.delete(fingerprint));
}

export async function clearFileHandles(): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }
  await handleDb.run("readwrite", (store) => store.clear());
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
