import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { requestWakeLock } from "./wake-lock";

function createLock() {
  return {
    release: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
  };
}

type FakeLock = ReturnType<typeof createLock>;

const initialStoreState = useAppStore.getState();

async function flushMicrotasks(count = 5) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

describe("requestWakeLock", () => {
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
    useAppStore.setState({ wakeLock: null });
    request = vi.fn();
    vi.stubGlobal("navigator", { wakeLock: { request } });
    vi.stubGlobal("document", { fullscreenElement: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the granted lock while in fullscreen", async () => {
    const lock = createLock();
    request.mockResolvedValue(lock);
    requestWakeLock();
    await flushMicrotasks();
    expect(useAppStore.getState().wakeLock).toBe(lock);
    expect(lock.addEventListener).toHaveBeenCalledWith(
      "release",
      expect.any(Function),
    );
  });

  it("does not double-acquire on two near-simultaneous calls", async () => {
    const lock = createLock();
    request.mockResolvedValue(lock);
    // Both calls fire before either request resolves and sets the store grant.
    requestWakeLock();
    requestWakeLock();
    expect(request).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(useAppStore.getState().wakeLock).toBe(lock);
  });

  it("releases a grant that resolves after leaving fullscreen", async () => {
    const lock = createLock();
    let resolveRequest!: (value: FakeLock) => void;
    request.mockReturnValue(
      new Promise<FakeLock>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    requestWakeLock();
    // Fullscreen exits while the request is still pending.
    (globalThis as unknown as { document: { fullscreenElement: unknown } })
      .document.fullscreenElement = null;
    resolveRequest(lock);
    await flushMicrotasks();
    expect(useAppStore.getState().wakeLock).toBeNull();
    expect(lock.release).toHaveBeenCalled();
  });
});
