type TimerCallback = (...args: unknown[]) => void;

interface PendingTimer {
  callback: TimerCallback;
  args: unknown[];
}

let worker: Worker | null = null;
const callbacks = new Map<number, PendingTimer>();
let nextId = 1;
let isDocumentHidden = typeof document !== "undefined" && document.hidden;

const nativeSetTimeout = (
  callback: TimerCallback,
  delay = 0,
  ...args: unknown[]
) => globalThis.setTimeout(callback, delay, ...args) as unknown as number;
const nativeClearTimeout = (id: number) => {
  globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
};

export function initBackgroundTimer(): void {
  if (worker) {
    return;
  }
  try {
    worker = new Worker("/worker.js");
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
  } catch (err) {
    console.warn("Background timer worker failed to initialize:", err);
    worker = null;
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      isDocumentHidden = document.hidden;
    });
  }
}

export function backgroundSetTimeout(
  callback: TimerCallback,
  delay = 0,
  ...args: unknown[]
): number {
  // Use a worker-backed timer when hidden to avoid aggressive background throttling.
  if (!worker || !isDocumentHidden) {
    return nativeSetTimeout(callback, delay, ...args);
  }
  const id = -nextId++;
  callbacks.set(id, { callback, args });
  worker.postMessage({ command: "setTimeout", id, delay });
  return id;
}

export function backgroundClearTimeout(id: number): void {
  if (id < 0) {
    callbacks.delete(id);
    worker?.postMessage({ command: "clearTimeout", id });
    return;
  }
  nativeClearTimeout(id);
}

function handleWorkerMessage(event: MessageEvent): void {
  const { type, id } = event.data || {};
  if (type !== "timeout") {
    return;
  }
  const pending = callbacks.get(id);
  if (!pending) {
    return;
  }
  callbacks.delete(id);
  pending.callback(...pending.args);
}

function handleWorkerError(err: ErrorEvent): void {
  console.warn("Background timer worker error:", err);
}
