import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rb = vi.hoisted(() => {
  let nextPtr = 16;
  const api = {
    rubberband_new: vi.fn(() => 1),
    rubberband_set_expected_input_duration: vi.fn(),
    rubberband_set_time_ratio: vi.fn(),
    rubberband_set_pitch_scale: vi.fn(),
    rubberband_get_samples_required: vi.fn(() => 4),
    rubberband_study: vi.fn(),
    rubberband_process: vi.fn(),
    rubberband_available: vi.fn(() => 4),
    rubberband_retrieve: vi.fn(() => 4),
    rubberband_delete: vi.fn(),
    malloc: vi.fn(() => {
      nextPtr += 64;
      return nextPtr;
    }),
    free: vi.fn(),
    memWrite: vi.fn(),
    memWritePtr: vi.fn(),
    memReadF32: vi.fn((_ptr: number, count: number) => new Float32Array(count)),
  };
  return {
    api,
    reset() {
      nextPtr = 16;
      Object.values(api).forEach((fn) => fn.mockClear());
    },
  };
});

vi.mock("rubberband-wasm", () => ({
  RubberBandOption: new Proxy({}, { get: () => 0 }),
  RubberBandInterface: { initialize: async () => rb.api },
}));
vi.mock("rubberband-wasm/dist/rubberband.wasm?url", () => ({ default: "rubberband.wasm" }));

type Response = { type: string; id: number; message?: string };

async function stretch(scope: { onmessage: ((event: MessageEvent) => void) | null }) {
  const posted = new Promise<Response>((resolve) => {
    (scope as unknown as { postMessage: (message: Response) => void }).postMessage = resolve;
  });
  scope.onmessage?.({
    data: {
      type: "stretch",
      id: 7,
      channels: [new Float32Array(8), new Float32Array(8)],
      sampleRate: 100,
      targetFrameCount: 12,
    },
  } as MessageEvent);
  return posted;
}

describe("rubberBandWorker", () => {
  let scope: { onmessage: ((event: MessageEvent) => void) | null };

  beforeEach(async () => {
    rb.reset();
    scope = { onmessage: null };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("fetch", async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.spyOn(WebAssembly, "compile").mockResolvedValue({} as WebAssembly.Module);
    vi.resetModules();
    await import("./rubberBandWorker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails a segment when Rubber Band stops handing over output", async () => {
    rb.api.rubberband_retrieve.mockReturnValue(0);

    const response = await stretch(scope);

    expect(response).toMatchObject({
      type: "error",
      id: 7,
      message: "Rubber Band stopped returning output",
    });
    expect(rb.api.rubberband_retrieve).toHaveBeenCalledTimes(5);
    expect(rb.api.rubberband_delete).toHaveBeenCalledWith(1);
  });

  it("frees buffers already allocated when a later allocation fails", async () => {
    rb.api.malloc
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(0);

    const response = await stretch(scope);

    expect(response).toMatchObject({
      type: "error",
      message: "Rubber Band could not allocate channel data",
    });
    expect(rb.api.free).toHaveBeenCalledWith(200);
    expect(rb.api.free).toHaveBeenCalledWith(100);
  });
});
