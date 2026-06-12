import { describe, expect, it, vi } from "vitest";
import { legacyAppState, useAppStore } from "./store";

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

  it("routes legacy state mutations through the store", () => {
    legacyAppState.isRunning = true;
    expect(useAppStore.getState().isRunning).toBe(true);
    expect(legacyAppState.isRunning).toBe(true);
    legacyAppState.isRunning = false;
  });

  it("notifies subscribers on legacy writes", () => {
    const listener = vi.fn();
    const unsubscribe = useAppStore.subscribe(listener);
    legacyAppState.trackTitle = "Song";
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    legacyAppState.trackTitle = null;
  });

  it("reads always reflect the latest snapshot", () => {
    useAppStore.setState({ lastJobId: "a3f3c0dc73c6476c9db95c227f9206f2" });
    expect(legacyAppState.lastJobId).toBe("a3f3c0dc73c6476c9db95c227f9206f2");
    useAppStore.setState({ lastJobId: null });
    expect(legacyAppState.lastJobId).toBeNull();
  });
});
