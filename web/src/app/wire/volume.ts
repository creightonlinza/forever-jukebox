import type { AppContext } from "../context";
import type { Elements } from "../elements";
import type { AutocanonizerController } from "../../autocanonizer/AutocanonizerController";
import type { BufferedAudioPlayer } from "../../audio/BufferedAudioPlayer";

type VolumeDeps = {
  context: AppContext;
  elements: Elements;
  player: BufferedAudioPlayer;
  autocanonizer: AutocanonizerController;
};

export type VolumeHandlers = ReturnType<typeof createVolumeHandlers>;

// Volume panel wiring (formerly part of wire/tuning.ts) — converts at 8b.
export function createVolumeHandlers(deps: VolumeDeps) {
  const { context, elements, player, autocanonizer } = deps;

  function handleVolumeInput() {
    elements.volumeVal.textContent = elements.volumeInput.value;
    const volume = Number(elements.volumeInput.value) / 100;
    player.setVolume(volume);
    autocanonizer.setVolume(volume);
    context.cowbellOverlay.setVolume(volume);
  }

  function handleVolumeButtonClick() {
    elements.volumeControlPanel.classList.toggle("is-hidden");
  }

  function handleVolumeDocumentClick(event: MouseEvent) {
    if (elements.volumeControlPanel.classList.contains("is-hidden")) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    const clickedInsidePanel = elements.volumeControlPanel.contains(target);
    const clickedVolumeButton = elements.volumeButton.contains(target);
    if (!clickedInsidePanel && !clickedVolumeButton) {
      elements.volumeControlPanel.classList.add("is-hidden");
    }
  }

  return {
    handleVolumeInput,
    handleVolumeButtonClick,
    handleVolumeDocumentClick,
  };
}
