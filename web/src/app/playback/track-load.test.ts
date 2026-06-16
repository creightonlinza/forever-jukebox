import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import { useAppStore } from "../store";

vi.mock("../cache", () => ({
  readCachedTrack: vi.fn(),
  updateCachedTrack: vi.fn(),
  deleteCachedTrack: vi.fn(),
}));
vi.mock("./status-ui", () => ({
  closeInfo: vi.fn(),
  closeTuning: vi.fn(),
  syncVolumeUI: vi.fn(),
  updateListenTimeDisplay: vi.fn(),
  updateTrackInfo: vi.fn(),
  updateVizVisibility: vi.fn(),
}));
vi.mock("./swing", () => ({ maybePrepareSwingMode: vi.fn() }));
vi.mock("./transport", () => ({ stopPlayback: vi.fn() }));

import { readCachedTrack } from "../cache";
import { maybePrepareSwingMode } from "./swing";
import { updateTrackInfo, updateVizVisibility } from "./status-ui";
import { tryLoadCachedAudio } from "./track-load";

const initialStoreState = useAppStore.getState();
const readCachedTrackMock = vi.mocked(readCachedTrack);

type TestAppContext = AppContext & {
  autocanonizer: NonNullable<AppContext["autocanonizer"]>;
};

function createContext() {
  const decodedBuffer = { duration: 12 } as AudioBuffer;
  const context = {
    player: {
      decode: vi.fn(async () => {}),
      getBuffer: vi.fn(() => decodedBuffer),
      getContext: vi.fn(() => "audio-context"),
    },
    autocanonizer: { setAudio: vi.fn() },
  } as unknown as TestAppContext;
  return { context, decodedBuffer };
}

describe("tryLoadCachedAudio", () => {
  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads cached audio on a hit and takes the fast path", async () => {
    const { context, decodedBuffer } = createContext();
    const audio = new ArrayBuffer(8);
    readCachedTrackMock.mockResolvedValue({ audio, jobId: "job-xyz" } as never);
    useAppStore.setState({
      audioLoaded: false,
      audioLoadInFlight: true,
      lastJobId: null,
    });

    const result = await tryLoadCachedAudio(context, "track-1");

    expect(result).toBe(true);
    expect(readCachedTrackMock).toHaveBeenCalledWith("track-1");
    expect(context.player.decode).toHaveBeenCalledWith(audio);
    // Restores the cached job id and marks the track loaded.
    expect(useAppStore.getState().lastJobId).toBe("job-xyz");
    expect(context.autocanonizer.setAudio).toHaveBeenCalledWith(
      decodedBuffer,
      "audio-context",
    );
    expect(useAppStore.getState().audioLoaded).toBe(true);
    expect(useAppStore.getState().audioLoadInFlight).toBe(false);
    // Swing prep runs on the cached buffer; viz/info refresh.
    expect(maybePrepareSwingMode).toHaveBeenCalledWith(context);
    expect(updateVizVisibility).toHaveBeenCalled();
    expect(updateTrackInfo).toHaveBeenCalledWith(context);
  });

  it("falls back to lastJobId=null when the cache entry has no job id", async () => {
    const { context } = createContext();
    readCachedTrackMock.mockResolvedValue({
      audio: new ArrayBuffer(4),
    } as never);
    useAppStore.setState({ lastJobId: "stale" });

    await tryLoadCachedAudio(context, "track-1");

    expect(useAppStore.getState().lastJobId).toBeNull();
  });

  it("returns false on a cache miss without touching the player", async () => {
    const { context } = createContext();
    readCachedTrackMock.mockResolvedValue(null as never);

    const result = await tryLoadCachedAudio(context, "track-1");

    expect(result).toBe(false);
    expect(context.player.decode).not.toHaveBeenCalled();
    expect(useAppStore.getState().audioLoaded).toBe(false);
  });

  it("returns false when the entry exists but has no audio", async () => {
    const { context } = createContext();
    readCachedTrackMock.mockResolvedValue({ jobId: "job" } as never);

    const result = await tryLoadCachedAudio(context, "track-1");

    expect(result).toBe(false);
    expect(context.player.decode).not.toHaveBeenCalled();
  });

  it("returns false and swallows when the cache read throws", async () => {
    const { context } = createContext();
    readCachedTrackMock.mockRejectedValue(new Error("idb failure"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await tryLoadCachedAudio(context, "track-1");

    expect(result).toBe(false);
    expect(useAppStore.getState().audioLoaded).toBe(false);
    warn.mockRestore();
  });
});
