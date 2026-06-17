import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { loadTrackById, loadTrackByJobId } from "./playback";
import { getAppContext, getPlaybackDeps } from "./runtime";
import { useAppStore } from "./store";
import { selectTrack } from "./track-select";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./playback", () => ({
  loadTrackById: vi.fn(),
  loadTrackByJobId: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getAppContext: vi.fn(),
  getPlaybackDeps: vi.fn(),
}));

const initialStoreState = useAppStore.getState();

describe("selectTrack", () => {
  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
    setWindowUrl("http://localhost/listen/current?jb=1&thresh=25");
    vi.clearAllMocks();
    vi.mocked(getAppContext).mockReturnValue({} as AppContext);
    vi.mocked(getPlaybackDeps).mockReturnValue({} as PlaybackDeps);
  });

  it("clears current tuning from fresh track navigation", () => {
    useAppStore.setState({
      playMode: "jukebox",
      tuningParams: "jb=1&thresh=25",
    });

    selectTrack("fresh-track", {
      id: "fresh-track",
      sourceType: "youtube",
      title: "Fresh",
      artist: "Artist",
      duration: null,
    });

    expect(useAppStore.getState().navigationRequest).toEqual({
      id: 1,
      to: "/listen/fresh-track",
      replace: undefined,
    });
    expect(loadTrackById).toHaveBeenCalledWith(
      {},
      {},
      "fresh-track",
      expect.objectContaining({
        selectedTrack: expect.objectContaining({ id: "fresh-track" }),
      }),
    );
    expect(loadTrackByJobId).not.toHaveBeenCalled();
  });
});
