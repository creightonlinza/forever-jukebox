import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context";
import type { Elements } from "../elements";
import type { BufferedAudioPlayer } from "../../audio/BufferedAudioPlayer";
import type { AutocanonizerController } from "../../autocanonizer/AutocanonizerController";
import { createTuningHandlers } from "./tuning";

function createMutableClassList(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: vi.fn((token: string) => {
      classes.add(token);
    }),
    remove: vi.fn((token: string) => {
      classes.delete(token);
    }),
    toggle: vi.fn((token: string, force?: boolean) => {
      if (force === true) {
        classes.add(token);
        return true;
      }
      if (force === false) {
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    }),
    contains: vi.fn((token: string) => classes.has(token)),
  };
}

function createDeps(activeTab: "tuning" | "extras" = "tuning") {
  let sleepTimerListener: (() => void) | null = null;
  const context = {
    state: {
      trackTitle: null,
      trackArtist: null,
      playMode: "jukebox",
      jukeboxAudioMode: "off",
      sleepTimer: {
        configuredDurationMs: null,
        endTimeMs: null,
        remainingMs: 0,
      },
    },
    cowbellOverlay: { setVolume: vi.fn() },
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
    sleepTimerOpen: { title: "", setAttribute: vi.fn() },
    sleepTimerModal: { classList: createMutableClassList() },
    sleepTimerClose: { title: "", setAttribute: vi.fn() },
    sleepTimerCancel: { title: "", setAttribute: vi.fn() },
    sleepTimerSet: { title: "", setAttribute: vi.fn() },
    sleepTimerSelect: { value: "off" },
    sleepTimerCurrent: { textContent: "" },
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
  const setSleepTimer = vi.fn(
    (targetContext: AppContext, durationMs: number | null) => {
      targetContext.state.sleepTimer = {
        configuredDurationMs: durationMs,
        endTimeMs: durationMs === null ? null : 1000 + durationMs,
        remainingMs: durationMs ?? 0,
      };
      sleepTimerListener?.();
    },
  );
  const addSleepTimerListener = vi.fn(
    (_targetContext: AppContext, listener: () => void) => {
      sleepTimerListener = listener;
      return vi.fn();
    },
  );

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
    setSleepTimer,
    addSleepTimerListener,
  });

  return {
    handlers,
    context,
    elements,
    player,
    autocanonizer,
    applyTuningChanges,
    resetTuningDefaults,
    applyExtrasChanges,
    resetExtrasDefaults,
    syncExtrasUI,
    syncTuningTabsUI,
    setActiveTuningTab,
    closeTuning,
    setSleepTimer,
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

  it("applies volume changes to player, autocanonizer, and cowbell overlay", () => {
    const { handlers, context, elements, player, autocanonizer } = createDeps();
    elements.volumeInput.value = "35";
    handlers.handleVolumeInput();
    expect(player.setVolume).toHaveBeenCalledWith(0.35);
    expect(autocanonizer.setVolume).toHaveBeenCalledWith(0.35);
    expect(context.cowbellOverlay.setVolume).toHaveBeenCalledWith(0.35);
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
    expect(tuningDeps.resetExtrasDefaults).not.toHaveBeenCalled();

    const extrasDeps = createDeps("extras");
    extrasDeps.handlers.handleTuningReset();
    expect(extrasDeps.resetExtrasDefaults).toHaveBeenCalledWith(extrasDeps.context);
    expect(extrasDeps.syncExtrasUI).toHaveBeenCalledWith(extrasDeps.context);
    expect(extrasDeps.syncTuningTabsUI).toHaveBeenCalledWith(extrasDeps.context);
    expect(extrasDeps.resetTuningDefaults).not.toHaveBeenCalled();
    expect(extrasDeps.closeTuning).toHaveBeenCalledWith(extrasDeps.context);
  });

  it("opens the sleep timer modal with the current selection", () => {
    const { handlers, context, elements } = createDeps();
    context.state.sleepTimer = {
      configuredDurationMs: 30 * 60 * 1000,
      endTimeMs: 30 * 60 * 1000,
      remainingMs: 90 * 1000,
    };

    handlers.handleOpenSleepTimer();

    expect(elements.sleepTimerModal.classList.add).toHaveBeenCalledWith("open");
    expect(elements.sleepTimerSelect.value).toBe("1800000");
    expect(elements.sleepTimerCurrent.textContent).toBe(
      "Current countdown: 00:01:30",
    );
  });

  it("keeps sleep timer dropdown changes pending until set", () => {
    const { handlers, context, elements, setSleepTimer } = createDeps();

    handlers.handleOpenSleepTimer();
    elements.sleepTimerSelect.value = "900000";
    handlers.handleSleepTimerSelectChange();

    expect(setSleepTimer).not.toHaveBeenCalled();
    expect(context.state.sleepTimer.configuredDurationMs).toBe(null);
  });

  it("applies the pending sleep timer option on set", () => {
    const { handlers, context, elements, setSleepTimer } = createDeps();

    handlers.handleOpenSleepTimer();
    elements.sleepTimerSelect.value = "900000";
    handlers.handleSleepTimerSelectChange();
    handlers.handleSleepTimerSet();

    expect(setSleepTimer).toHaveBeenCalledWith(context, 900000);
    expect(elements.sleepTimerModal.classList.remove).toHaveBeenCalledWith("open");
  });

  it("dismisses sleep timer modal without applying pending changes", () => {
    const { handlers, elements, setSleepTimer } = createDeps();

    handlers.handleOpenSleepTimer();
    elements.sleepTimerSelect.value = "900000";
    handlers.handleSleepTimerSelectChange();
    handlers.handleCloseSleepTimer();

    expect(setSleepTimer).not.toHaveBeenCalled();
    expect(elements.sleepTimerModal.classList.remove).toHaveBeenCalledWith("open");
  });

  it("dismisses sleep timer modal on backdrop click without applying", () => {
    const { handlers, elements, setSleepTimer } = createDeps();
    const event = { target: elements.sleepTimerModal } as unknown as MouseEvent;

    handlers.handleSleepTimerModalClick(event);

    expect(setSleepTimer).not.toHaveBeenCalled();
    expect(elements.sleepTimerModal.classList.remove).toHaveBeenCalledWith("open");
  });

  it("shows off when sleep timer remaining time is zero", () => {
    const { handlers, elements } = createDeps();

    handlers.syncSleepTimerUi();

    expect(elements.sleepTimerCurrent.textContent).toBe("Off");
  });

  it("resets pending sleep timer selection when external state changes", () => {
    const { handlers, context, elements, setSleepTimer } = createDeps();

    handlers.handleOpenSleepTimer();
    elements.sleepTimerSelect.value = "900000";
    handlers.handleSleepTimerSelectChange();

    setSleepTimer(context, 30 * 60 * 1000);

    expect(elements.sleepTimerSelect.value).toBe("1800000");
    expect(elements.sleepTimerCurrent.textContent).toBe(
      "Current countdown: 00:30:00",
    );
  });
});
