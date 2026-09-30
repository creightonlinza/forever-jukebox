import type * as Ort from "onnxruntime-web/webgpu";
import ortSource from "onnxruntime-web/webgpu?raw";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

export type SeparateRequest = {
  type: "separate";
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
};

export type SeparationPhase = "download" | "separate";

type WorkerResponse =
  | { type: "progress"; phase: SeparationPhase; progress: number }
  | { type: "result"; left: Float32Array; right: Float32Array }
  | { type: "error"; message: string };

type WorkerScope = {
  location: { href: string };
  onmessage: ((event: MessageEvent<SeparateRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

export type ModelFile = { url: string; bytes: number };
export type Backend = "webgpu" | "wasm";

// Falls back to globalThis so the module also loads outside a worker (tests).
const workerSelf = (
  typeof self === "undefined" ? globalThis : self
) as unknown as WorkerScope;
const MODEL_CACHE = "fj-instrumental-models";

let ortPromise: Promise<typeof Ort> | null = null;

export function loadOrt(): Promise<typeof Ort> {
  ortPromise ??= importOrt();
  return ortPromise;
}

// The runtime ships prebuilt for modern browsers. Importing its source from
// a blob keeps it out of the app's bundle targets and dev-server transforms.
async function importOrt(): Promise<typeof Ort> {
  const moduleUrl = URL.createObjectURL(
    new Blob([ortSource], { type: "text/javascript" }),
  );
  const ort = (await import(/* @vite-ignore */ moduleUrl)) as typeof Ort;
  URL.revokeObjectURL(moduleUrl);
  ort.env.wasm.wasmPaths = {
    wasm: new URL(ortWasmUrl, workerSelf.location.href).href,
  };
  // Threads need cross-origin isolation, which the app does not enable.
  ort.env.wasm.numThreads = 1;
  return ort;
}

export function postProgress(phase: SeparationPhase, progress: number) {
  workerSelf.postMessage({ type: "progress", phase, progress });
}

async function downloadModel(
  file: ModelFile,
  onBytes: (received: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(file.url);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed with status ${response.status}`);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.bytes);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (received + value.byteLength > file.bytes) {
      throw new Error("Model download is larger than expected");
    }
    bytes.set(value, received);
    received += value.byteLength;
    onBytes(value.byteLength);
  }
  // A size mismatch means an error page or a truncated file; never cache it.
  if (received !== file.bytes) {
    throw new Error("Model download is smaller than expected");
  }
  return bytes;
}

// Fails before any download when WebGPU is present but has no usable adapter.
export async function ensureWebGpuAdapter() {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } })
    .gpu;
  if (!gpu || !(await gpu.requestAdapter())) {
    throw new Error("No WebGPU adapter is available");
  }
}

// Posts download progress only when the whole percent changes, and once at
// 1 after the last file is stored so the caller can tell the download is done.
export async function loadModels(files: readonly ModelFile[]) {
  const cache = await caches.open(MODEL_CACHE);
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  let loadedBytes = 0;
  let lastPercent = -1;
  let fromCache = true;
  const models: Uint8Array<ArrayBuffer>[] = [];
  const report = () => {
    const percent = Math.floor((loadedBytes / totalBytes) * 100);
    if (percent < 100 && percent !== lastPercent) {
      lastPercent = percent;
      postProgress("download", loadedBytes / totalBytes);
    }
  };
  for (const file of files) {
    const cached = await cache.match(file.url);
    const cachedBytes = cached
      ? new Uint8Array(await cached.arrayBuffer())
      : null;
    if (cachedBytes?.byteLength === file.bytes) {
      loadedBytes += file.bytes;
      models.push(cachedBytes);
      continue;
    }
    fromCache = false;
    report();
    const bytes = await downloadModel(file, (received) => {
      loadedBytes += received;
      report();
    });
    await cache.put(
      file.url,
      new Response(bytes, {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    models.push(bytes);
  }
  if (!fromCache) {
    postProgress("download", 1);
  }
  return { models, fromCache };
}

// Tries each backend in order and uses the first that can load every model.
export async function createSessions(
  ort: typeof Ort,
  models: Uint8Array[],
  backends: readonly Backend[],
) {
  const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  let failure: unknown = new Error("No supported backend is available");
  for (const backend of backends) {
    if (backend === "webgpu" && !hasWebGpu) {
      continue;
    }
    try {
      const sessions = [];
      for (const model of models) {
        sessions.push(
          await ort.InferenceSession.create(model, {
            executionProviders: [backend],
          }),
        );
      }
      return { backend, sessions };
    } catch (err) {
      failure = err;
      console.warn(`[instrumental] ${backend} backend unavailable`, err);
    }
  }
  throw failure;
}

export async function runSession(
  session: Ort.InferenceSession,
  input: Ort.Tensor,
) {
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const output = outputs[session.outputNames[0]];
  const data = Float32Array.from(output.data as Float32Array);
  output.dispose();
  return data;
}

export function serveSeparation(
  separate: (
    request: SeparateRequest,
  ) => Promise<{ left: Float32Array; right: Float32Array }>,
) {
  workerSelf.onmessage = (event) => {
    if (event.data?.type !== "separate") {
      return;
    }
    separate(event.data)
      .then(({ left, right }) => {
        workerSelf.postMessage({ type: "result", left, right }, [
          left.buffer,
          right.buffer,
        ]);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        workerSelf.postMessage({
          type: "error",
          message: message.trim() || "unknown instrumental worker failure",
        });
      });
  };
}
