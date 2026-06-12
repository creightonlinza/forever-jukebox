import { describe, expect, it } from "vitest";
import { useAppStore } from "./store";

describe("app store", () => {
  it("exposes the Phase 3 slice fields with bootstrap defaults", () => {
    const s = useAppStore.getState();
    expect(s.activeTabId).toBe("top");
    expect(s.playMode).toBe("jukebox");
    expect(s.topSongsTab).toBe("top");
    expect(s.searchTab).toBe("search");
    expect(s.isRunning).toBe(false);
    expect(s.sleepTimer).toEqual({
      configuredDurationMs: null,
      endTimeMs: null,
      remainingMs: 0,
    });
    expect(s.deletedEdgeIds).toEqual([]);
    expect(s.favorites).toEqual([]);
    expect(s.appConfig).toBeNull();
  });

  it("reads always reflect the latest snapshot", () => {
    useAppStore.setState({ lastJobId: "a3f3c0dc73c6476c9db95c227f9206f2" });
    expect(useAppStore.getState().lastJobId).toBe(
      "a3f3c0dc73c6476c9db95c227f9206f2",
    );
    useAppStore.setState({ lastJobId: null });
    expect(useAppStore.getState().lastJobId).toBeNull();
  });
});
