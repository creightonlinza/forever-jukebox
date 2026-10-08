import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import { useAppStore } from "../store";

type Render = {
  buffer: { duration: number };
  parts: Array<{ kind: string; label: string; start: number; duration: number }>;
};
let resolveRender!: (render: Render) => void;
let rejectRender!: (err: Error) => void;
const renderWubMachineBuffer = vi.fn(
  (..._args: unknown[]) =>
    new Promise<Render>((resolve, reject) => {
      resolveRender = resolve;
      rejectRender = reject;
    }),
);

vi.mock("@forever-jukebox/shared/wubmachine/wubMachineRender", () => ({
  renderWubMachineBuffer: (...args: unknown[]) => renderWubMachineBuffer(...args),
}));
const showToast = vi.fn();
vi.mock("../ui", () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));
vi.mock("./status-ui", () => ({
  updatePlayButton: vi.fn(),
  updateVizVisibility: vi.fn(),
}));

import {
  cancelWubMachineRender,
  maybePrepareWubMachine,
  resetWubMachine,
  setWubMachineAnalysis,
} from "./wubmachine";

const initialStoreState = useAppStore.getState();
const render: Render = {
  buffer: { duration: 2 },
  parts: [{ kind: "intro", label: "intro", start: 0, duration: 2 }],
};

async function flushMicrotasks(count = 5) {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve();
  }
}

function createContext() {
  const wubmachine = {
    isReady: vi.fn(() => false),
    setRemix: vi.fn(),
  };
  const context = {
    player: {
      getSourceBuffer: () => ({
        numberOfChannels: 1,
        sampleRate: 1000,
        getChannelData: () => new Float32Array(10),
      }),
      getContext: () => ({}),
    },
    wubmachine,
  } as unknown as AppContext;
  return { context, wubmachine };
}

describe("maybePrepareWubMachine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(initialStoreState, true);
    const { context } = createContext();
    resetWubMachine(context);
    useAppStore.setState({
      playMode: "wubmachine",
      audioLoaded: true,
      analysisLoaded: true,
    });
    setWubMachineAnalysis({ beats: [] });
  });

  it("does nothing outside Wub Machine mode", () => {
    useAppStore.setState({ playMode: "jukebox" });
    maybePrepareWubMachine(createContext().context);
    expect(renderWubMachineBuffer).not.toHaveBeenCalled();
  });

  it("renders once and hands the remix to the controller", async () => {
    const { context, wubmachine } = createContext();
    maybePrepareWubMachine(context);
    maybePrepareWubMachine(context);
    expect(renderWubMachineBuffer).toHaveBeenCalledTimes(1);
    expect(renderWubMachineBuffer.mock.calls[0]?.[2]).toEqual({ beats: [] });
    expect(useAppStore.getState().audioModePreparing).toBe(true);

    resolveRender(render);
    await flushMicrotasks();

    expect(wubmachine.setRemix).toHaveBeenLastCalledWith(
      render.buffer,
      expect.anything(),
      render.parts,
    );
    expect(useAppStore.getState().audioModePreparing).toBe(false);
    expect(useAppStore.getState().wubMachineDurationSec).toBe(2);
  });

  it("skips the render when the remix is already loaded", () => {
    const { context, wubmachine } = createContext();
    wubmachine.isReady.mockReturnValue(true);
    maybePrepareWubMachine(context);
    expect(renderWubMachineBuffer).not.toHaveBeenCalled();
  });

  it("drops a render cancelled by leaving the mode", async () => {
    const { context, wubmachine } = createContext();
    maybePrepareWubMachine(context);
    const signal = (
      renderWubMachineBuffer.mock.calls[0]?.[3] as { signal: AbortSignal }
    ).signal;
    cancelWubMachineRender();
    expect(signal.aborted).toBe(true);
    expect(useAppStore.getState().audioModePreparing).toBe(false);

    resolveRender(render);
    await flushMicrotasks();
    expect(wubmachine.setRemix).not.toHaveBeenCalled();
  });

  it("reports a failed render and allows a retry", async () => {
    const { context } = createContext();
    maybePrepareWubMachine(context);
    rejectRender(new Error("boom"));
    await flushMicrotasks();

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().audioModePreparing).toBe(false);
    maybePrepareWubMachine(context);
    expect(renderWubMachineBuffer).toHaveBeenCalledTimes(2);
  });
});
