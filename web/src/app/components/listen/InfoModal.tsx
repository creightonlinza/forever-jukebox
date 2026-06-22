import { useAppStore } from "../../store";
import { Modal } from "../Modal";

const KEYBOARD_ROWS: Array<[string, string]> = [
  ["Space:", "Start/stop playback"],
  ["Shift (hold):", "Force branching while playing"],
  ["Left/Right:", "Cycle selected branch"],
  ["[ / ]:", "Decrease/increase play velocity"],
  ["Down/Up:", "Set play velocity to 0/+1"],
  ["Control (hold):", "Freeze on the current beat"],
  ["A:", "Set/reset selected anchor branch"],
  ["Delete:", "Remove a selected branch"],
  ["E:", "Open the Extras menu"],
  ["H:", "Toggle Bring It Home mode"],
];

export function InfoModal() {
  const open = useAppStore((s) => s.infoModalOpen);
  const trackInfo = useAppStore((s) => s.trackInfo);
  const close = () => useAppStore.setState({ infoModalOpen: false });

  return (
    <Modal id="info-modal" open={open} onClose={close}>
      <div className="modal-header">
        <h2>Track Info</h2>
        <button
          id="info-close"
          className="modal-close"
          aria-label="Close"
          onClick={close}
        >
          <span
            className="material-symbols-outlined modal-close-icon"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </div>
      <div className="modal-body info-body">
        <div className="info-row">
          <span className="info-label">Track length:</span>
          <span id="info-duration">{trackInfo.durationText}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Total beats:</span>
          <span id="info-beats">{trackInfo.totalBeats}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Total branches:</span>
          <span id="info-branches">{trackInfo.branchCount}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Deleted branches:</span>
          <span id="info-deleted-branches">{trackInfo.deletedCount}</span>
        </div>
        <h4>Keyboard commands</h4>
        {KEYBOARD_ROWS.map(([label, text]) => (
          <div className="info-row" key={label}>
            <span className="info-label">{label}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
