import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessions,
  ensureWebGpuAdapter,
  loadModels,
} from "./instrumentalRuntime";

function createCacheStorage() {
  const store = new Map<string, ArrayBuffer>();
  return {
    store,
    open: async () => ({
      match: async (url: string) => {
        const bytes = store.get(url);
        return bytes ? new Response(bytes.slice(0)) : undefined;
      },
      put: async (url: string, response: Response) => {
        store.set(url, await response.arrayBuffer());
      },
    }),
  };
}

function streamedResponse(chunks: Uint8Array[], ok = true) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return { ok, status: ok ? 200 : 500, body };
}

const file = { url: "https://models.test/model.onnx", bytes: 6 };

describe("loadModels", () => {
  let cacheStorage: ReturnType<typeof createCacheStorage>;
  const postMessage = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    cacheStorage = createCacheStorage();
    vi.stubGlobal("caches", cacheStorage);
    vi.stubGlobal("postMessage", postMessage);
    vi.stubGlobal("fetch", fetchMock);
    postMessage.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads, reports progress and stores the model", async () => {
    fetchMock.mockResolvedValue(
      streamedResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5, 6])]),
    );

    const { models, fromCache } = await loadModels([file]);

    expect(fromCache).toBe(false);
    expect(Array.from(models[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cacheStorage.store.has(file.url)).toBe(true);
    expect(
      postMessage.mock.calls.map(([message]) => message.progress),
    ).toEqual([0, 2 / 6, 1]);
  });

  it("reports download progress once per whole percent", async () => {
    const big = { url: file.url, bytes: 200 };
    fetchMock.mockResolvedValue(
      streamedResponse(Array.from({ length: 200 }, () => new Uint8Array([1]))),
    );

    await loadModels([big]);

    const progress = postMessage.mock.calls.map(([message]) => message.progress);
    expect(progress).toHaveLength(101);
    expect(new Set(progress).size).toBe(progress.length);
    expect(progress.at(-1)).toBe(1);
  });

  it("serves a stored model without fetching", async () => {
    cacheStorage.store.set(file.url, new Uint8Array([9, 9, 9, 9, 9, 9]).buffer);

    const { models, fromCache } = await loadModels([file]);

    expect(fromCache).toBe(true);
    expect(models[0]).toHaveLength(6);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-downloads a stored model of the wrong size", async () => {
    cacheStorage.store.set(file.url, new Uint8Array([9]).buffer);
    fetchMock.mockResolvedValue(
      streamedResponse([new Uint8Array([1, 2, 3, 4, 5, 6])]),
    );

    const { fromCache } = await loadModels([file]);

    expect(fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["truncated", [new Uint8Array([1, 2, 3])], /smaller than expected/],
    [
      "oversized",
      [new Uint8Array([1, 2, 3, 4, 5, 6, 7])],
      /larger than expected/,
    ],
  ])("rejects a %s download and stores nothing", async (_label, chunks, error) => {
    fetchMock.mockResolvedValue(streamedResponse(chunks));

    await expect(loadModels([file])).rejects.toThrow(error);
    expect(cacheStorage.store.has(file.url)).toBe(false);
  });

  it("rejects an error response", async () => {
    fetchMock.mockResolvedValue(streamedResponse([], false));
    await expect(loadModels([file])).rejects.toThrow(/status 500/);
  });
});

describe("createSessions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeOrt(failing: string[]) {
    return {
      InferenceSession: {
        create: vi.fn(async (_model: Uint8Array, options: { executionProviders: string[] }) => {
          const backend = options.executionProviders[0];
          if (failing.includes(backend)) {
            throw new Error(`${backend} unavailable`);
          }
          return { backend };
        }),
      },
    } as never;
  }

  it("skips WebGPU when the browser lacks it", async () => {
    vi.stubGlobal("navigator", {});
    const ort = fakeOrt([]);
    const { backend } = await createSessions(ort, [new Uint8Array(1)], [
      "webgpu",
      "wasm",
    ]);
    expect(backend).toBe("wasm");
  });

  it("falls back to the next backend when one fails to load", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ort = fakeOrt(["webgpu"]);
    const { backend, sessions } = await createSessions(
      ort,
      [new Uint8Array(1), new Uint8Array(1)],
      ["webgpu", "wasm"],
    );
    expect(backend).toBe("wasm");
    expect(sessions).toHaveLength(2);
    warn.mockRestore();
  });

  it("rejects with the last failure when no backend works", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      createSessions(fakeOrt(["webgpu"]), [new Uint8Array(1)], ["webgpu"]),
    ).rejects.toThrow("webgpu unavailable");
    await expect(
      createSessions(fakeOrt([]), [new Uint8Array(1)], []),
    ).rejects.toThrow(/No supported backend/);
    warn.mockRestore();
  });
});

describe("ensureWebGpuAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves when an adapter is available", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({}) } });
    await expect(ensureWebGpuAdapter()).resolves.toBeUndefined();
  });

  it("rejects when WebGPU is present but has no adapter", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    await expect(ensureWebGpuAdapter()).rejects.toThrow(/adapter/);
  });

  it("rejects without WebGPU", async () => {
    vi.stubGlobal("navigator", {});
    await expect(ensureWebGpuAdapter()).rejects.toThrow(/adapter/);
  });
});
