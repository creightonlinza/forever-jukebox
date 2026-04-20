import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import type { Elements } from "../elements";
import type { BufferedAudioPlayer } from "../../audio/BufferedAudioPlayer";
import type { AutocanonizerController } from "../../autocanonizer/AutocanonizerController";
import { createTuningHandlers } from "./tuning";

function createDeps(activeTab: "tuning" | "extras" = "tuning") {
  const context = {
    state: {
      trackTitle: null,
      trackArtist: null,
      playMode: "jukebox",
      jukeboxAudioMode: "off",
    },
  } as unknown as AppContext;
  const elements = {
    thresholdInput: { value: "0" },
    thresholdVal: { textContent: "" },
    minProbInput: { value: "0" },
    minProbVal: { textContent: "" },
    maxProbInput: { value: "0" },
    maxProbVal: { textContent: "" },
    rampInput: { value: "0" },
    rampVal: { textContent: "" },
    volumeInput: { value: "50" },
    volumeVal: { textContent: "" },
    infoButton: { title: "", setAttribute: vi.fn() },
    tuningButton: { title: "", setAttribute: vi.fn() },
    shortUrlButton: { title: "", setAttribute: vi.fn() },
    tuningModal: {},
    infoModal: {},
    volumeControlPanel: {
      classList: { toggle: vi.fn(), contains: vi.fn(() => false), add: vi.fn() },
      contains: vi.fn(() => false),
    },
    volumeButton: { contains: vi.fn(() => false) },
    playTitle: { textContent: "" },
    vizNowPlayingEl: { textContent: "" },
  } as unknown as Elements;
  const player = { setVolume: vi.fn() } as unknown as BufferedAudioPlayer;
  const autocanonizer =
    { setVolume: vi.fn() } as unknown as AutocanonizerController;

  const openTuning = vi.fn();
  const closeTuning = vi.fn();
  const openInfo = vi.fn();
  const closeInfo = vi.fn();
  const applyTuningChanges = vi.fn();
  const resetTuningDefaults = vi.fn();
  const applyExtrasChanges = vi.fn(() => ({
    branchStatsChanged: true,
    audioModeChanged: false,
  }));
  const resetExtrasDefaults = vi.fn(() => ({
    branchStatsChanged: true,
    audioModeChanged: false,
  }));
  const syncExtrasUI = vi.fn();
  const syncTuningTabsUI = vi.fn();
  const setActiveTuningTab = vi.fn();
  const getActiveTuningTab = vi.fn(() => activeTab);

  const handlers = createTuningHandlers({
    context,
    elements,
    player,
    autocanonizer,
    openTuning,
    closeTuning,
    openInfo,
    closeInfo,
    applyTuningChanges,
    resetTuningDefaults,
    applyExtrasChanges,
    resetExtrasDefaults,
    syncExtrasUI,
    syncTuningTabsUI,
    setActiveTuningTab,
    getActiveTuningTab,
  });

  return {
    handlers,
    context,
    applyTuningChanges,
    resetTuningDefaults,
    applyExtrasChanges,
    resetExtrasDefaults,
    syncExtrasUI,
    syncTuningTabsUI,
    setActiveTuningTab,
    closeTuning,
  };
}

describe("tuning wire handlers", () => {
  it("toggles from tuning to extras when header toggle is clicked", () => {
    const { handlers, context, setActiveTuningTab } = createDeps("tuning");
    handlers.handleTuningTabToggle();
    expect(setActiveTuningTab).toHaveBeenCalledWith(context, "extras");
  });

  it("routes apply to tuning changes when tuning tab is active", () => {
    const { handlers, context, applyTuningChanges, applyExtrasChanges, closeTuning } =
      createDeps("tuning");
    handlers.handleTuningApply();
    expect(applyTuningChanges).toHaveBeenCalledWith(context);
    expect(applyExtrasChanges).not.toHaveBeenCalled();
    expect(closeTuning).not.toHaveBeenCalled();
  });

  it("routes apply to extras changes when extras tab is active", () => {
    const {
      handlers,
      context,
      applyTuningChanges,
      applyExtrasChanges,
      syncExtrasUI,
      syncTuningTabsUI,
      closeTuning,
    } = createDeps("extras");
    handlers.handleTuningApply();
    expect(applyTuningChanges).not.toHaveBeenCalled();
    expect(applyExtrasChanges).toHaveBeenCalledWith(context);
    expect(syncExtrasUI).toHaveBeenCalledWith(context);
    expect(syncTuningTabsUI).toHaveBeenCalledWith(context);
    expect(closeTuning).toHaveBeenCalledWith(context);
  });

  it("routes reset by active tab", () => {
    const tuningDeps = createDeps("tuning");
    tuningDeps.handlers.handleTuningReset();
    expect(tuningDeps.resetTuningDefaults).toHaveBeenCalledWith(tuningDeps.context);
    expect(tuningDeps.closeTuning).toHaveBeenCalledWith(tuningDeps.context);

    const extrasDeps = createDeps("extras");
    extrasDeps.handlers.handleTuningReset();
    expect(extrasDeps.resetExtrasDefaults).toHaveBeenCalledWith(extrasDeps.context);
    expect(extrasDeps.syncExtrasUI).toHaveBeenCalledWith(extrasDeps.context);
    expect(extrasDeps.syncTuningTabsUI).toHaveBeenCalledWith(extrasDeps.context);
    expect(extrasDeps.closeTuning).toHaveBeenCalledWith(extrasDeps.context);
  });
});
