import type { AppContext } from "../context";
import type { Elements } from "../elements";
import type { AutocanonizerController } from "../../autocanonizer/AutocanonizerController";
import type { BufferedAudioPlayer } from "../../audio/BufferedAudioPlayer";

type TuningDeps = {
  context: AppContext;
  elements: Elements;
  player: BufferedAudioPlayer;
  autocanonizer: AutocanonizerController;
  openTuning: (context: AppContext) => void;
  closeTuning: (context: AppContext) => void;
  openInfo: (context: AppContext) => void;
  closeInfo: (context: AppContext) => void;
  applyTuningChanges: (context: AppContext) => void;
  resetTuningDefaults: (context: AppContext) => void;
};

export type TuningHandlers = ReturnType<typeof createTuningHandlers>;

export function createTuningHandlers(deps: TuningDeps) {
  const {
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
  } = deps;

  function handleThresholdInput() {
    elements.thresholdVal.textContent = elements.thresholdInput.value;
  }

  function handleMinProbInput() {
    elements.minProbVal.textContent = `${elements.minProbInput.value}%`;
  }

  function handleMaxProbInput() {
    elements.maxProbVal.textContent = `${elements.maxProbInput.value}%`;
  }

  function handleRampInput() {
    elements.rampVal.textContent = `${elements.rampInput.value}%`;
  }

  function handleVolumeInput() {
    elements.volumeVal.textContent = elements.volumeInput.value;
    const volume = Number(elements.volumeInput.value) / 100;
    player.setVolume(volume);
    autocanonizer.setVolume(volume);
  }

  function handleOpenTuning() {
    openTuning(context);
  }

  function handleOpenInfo() {
    openInfo(context);
  }

  function handleCloseTuning() {
    closeTuning(context);
  }

  function handleCloseInfo() {
    closeInfo(context);
  }

  function syncInfoButton() {
    elements.infoButton.title = "Info";
    elements.infoButton.setAttribute("aria-label", "Info");
  }

  function syncTuneButton() {
    elements.tuningButton.title = "Tune";
    elements.tuningButton.setAttribute("aria-label", "Tune");
  }

  function syncCopyButton() {
    elements.shortUrlButton.title = "Copy URL";
    elements.shortUrlButton.setAttribute("aria-label", "Copy URL");
  }

  function handleTuningModalClick(event: MouseEvent) {
    if (event.target === elements.tuningModal) {
      closeTuning(context);
    }
  }

  function handleInfoModalClick(event: MouseEvent) {
    if (event.target === elements.infoModal) {
      closeInfo(context);
    }
  }

  function handleTuningApply() {
    applyTuningChanges(context);
  }

  function handleTuningReset() {
    resetTuningDefaults(context);
    //closeTuning(context);
  }

  return {
    handleThresholdInput,
    handleMinProbInput,
    handleMaxProbInput,
    handleRampInput,
    handleVolumeInput,
    handleOpenTuning,
    handleOpenInfo,
    handleCloseTuning,
    handleCloseInfo,
    syncInfoButton,
    syncTuneButton,
    syncCopyButton,
    handleTuningModalClick,
    handleInfoModalClick,
    handleTuningApply,
    handleTuningReset,
  };
}
