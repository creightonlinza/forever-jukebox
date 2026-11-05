import { describe, expect, it, vi } from "vitest";
import { getFileHandle, readFileFromHandle } from "../fileHandleStore";

const song = new File([new Uint8Array([1])], "song.mp3");

function fakeHandle(options: {
  query?: PermissionState;
  request?: PermissionState;
  getFile?: () => Promise<File>;
}) {
  return {
    kind: "file",
    name: "song.mp3",
    queryPermission: options.query ? vi.fn(async () => options.query) : undefined,
    requestPermission: options.request ? vi.fn(async () => options.request) : undefined,
    getFile: options.getFile ?? (async () => song),
  } as unknown as FileSystemFileHandle;
}

describe("readFileFromHandle", () => {
  it("reads the file when access is already granted", async () => {
    const handle = fakeHandle({ query: "granted", request: "denied" });
    expect(await readFileFromHandle(handle)).toBe(song);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it("asks for access when the browser no longer holds it", async () => {
    const handle = fakeHandle({ query: "prompt", request: "granted" });
    expect(await readFileFromHandle(handle)).toBe(song);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: "read" });
  });

  it("gives up when access is refused", async () => {
    const handle = fakeHandle({ query: "prompt", request: "denied" });
    expect(await readFileFromHandle(handle)).toBeNull();
  });

  it("gives up when the file is gone", async () => {
    const handle = fakeHandle({
      query: "granted",
      getFile: async () => {
        throw new DOMException("missing", "NotFoundError");
      },
    });
    expect(await readFileFromHandle(handle)).toBeNull();
  });
});

describe("file handle storage", () => {
  it("finds nothing without IndexedDB", async () => {
    expect(typeof indexedDB).toBe("undefined");
    expect(await getFileHandle("fp-1")).toBeNull();
  });
});
