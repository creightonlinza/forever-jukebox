import type { MouseEvent } from "react";
import { ANCHOR_HIGHLIGHT_COLOR, ANCHOR_MATCH_COLORS } from "../constants/visualization";
import { beatPairMatch } from "../engine/graph";
import type { CustomAnchorEnd } from "../engine/selection";
import type { QuantumBase } from "../engine/types";
import type { AnchorEditState } from "../viz/JukeboxViz";
import "./CustomAnchorEditor.css";

// Each app passes its own translations; times arrive as seconds for the app to format.
export type CustomAnchorLabels = {
  setCustomAnchor: string;
  title: string;
  hint: string;
  from: string;
  to: string;
  beat: (beat: number, seconds: number) => string;
  snap: string;
  snapHint: string;
  reset: string;
  done: string;
  match: string;
  barPosition: string;
  loopLabel: string;
  loop: (beats: number, seconds: number, bars: number | null) => string;
};

// App hotkeys skip a focused button, so a mouse click must not leave focus behind.
function releaseMouseFocus(event: MouseEvent<HTMLButtonElement>) {
  if (event.detail > 0) {
    event.currentTarget.blur();
  }
}

// "2/4": the beat's place in its bar, or a dash when the analysis has no bars.
function barPosition(beat: QuantumBase): string {
  const count = beat.parent?.children?.length;
  if (beat.indexInParent === undefined || !count) {
    return "–";
  }
  return `${beat.indexInParent + 1}/${count}`;
}

export function CustomAnchorButton({
  labels,
  disabled,
  onStart,
}: {
  labels: Pick<CustomAnchorLabels, "setCustomAnchor">;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      id="custom-anchor-start"
      className="custom-anchor-button"
      disabled={disabled}
      onClick={(event) => {
        releaseMouseFocus(event);
        onStart();
      }}
    >
      {labels.setCustomAnchor}
    </button>
  );
}

// Takes over the viz-top row while editing, so its controls never cover a beat in any layout.
export function CustomAnchorToolbar({
  edit,
  beats,
  labels,
  onSelectEnd,
  onSnap,
  onReset,
  onDone,
}: {
  edit: AnchorEditState;
  beats: readonly QuantumBase[];
  labels: CustomAnchorLabels;
  onSelectEnd: (end: CustomAnchorEnd) => void;
  onSnap: () => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const ends: Array<[CustomAnchorEnd, string]> = [
    ["src", labels.from],
    ["dest", labels.to],
  ];
  return (
    <div
      id="custom-anchor-toolbar"
      className="custom-anchor-toolbar"
      role="toolbar"
      aria-label={labels.title}
      title={labels.hint}
    >
      {ends.map(([end, label]) => (
        <button
          key={end}
          type="button"
          className={edit.active === end ? "custom-anchor-end is-active" : "custom-anchor-end"}
          aria-pressed={edit.active === end}
          aria-label={`${label} ${edit[end]}`}
          title={labels.beat(edit[end], beats[edit[end]]?.start ?? 0)}
          onClick={(event) => {
            releaseMouseFocus(event);
            onSelectEnd(end);
          }}
        >
          <span
            className={`custom-anchor-dot is-${end}`}
            style={end === "src" ? { background: ANCHOR_HIGHLIGHT_COLOR } : undefined}
            aria-hidden="true"
          />
          <span className="custom-anchor-label">{label}</span> {edit[end]}
        </button>
      ))}
      <span className="custom-anchor-actions">
        <button
          type="button"
          id="custom-anchor-snap"
          title={labels.snapHint}
          onClick={(event) => {
            releaseMouseFocus(event);
            onSnap();
          }}
        >
          {labels.snap}
        </button>
        <button
          type="button"
          id="custom-anchor-reset"
          onClick={(event) => {
            releaseMouseFocus(event);
            onReset();
          }}
        >
          {labels.reset}
        </button>
        <button type="button" id="custom-anchor-done" className="is-primary" onClick={onDone}>
          {labels.done}
        </button>
      </span>
    </div>
  );
}

// Read-only pair readout in the branch-stats corner; it takes no pointer events,
// so a handle under it still drags.
export function CustomAnchorInfo({
  edit,
  beats,
  labels,
}: {
  edit: AnchorEditState;
  beats: readonly QuantumBase[];
  labels: CustomAnchorLabels;
}) {
  const from = beats[edit.src];
  const to = beats[edit.dest];
  if (!from || !to) {
    return null;
  }
  const match = beatPairMatch(from, to);
  const bars = from.parent && to.parent ? from.parent.which - to.parent.which : null;
  // The third field marks a value shown in the warning colour.
  const rows: Array<[string, string, boolean]> = [
    [labels.match, `${match.percent}%`, false],
    [labels.barPosition, `${barPosition(from)} → ${barPosition(to)}`, !match.sameBarPosition],
    [labels.loopLabel, labels.loop(edit.src - edit.dest, Math.max(0, from.start - to.start), bars), false],
  ];
  return (
    <div
      id="custom-anchor-info"
      className={`custom-anchor-info is-${match.quality}`}
      style={{ borderLeftColor: ANCHOR_MATCH_COLORS[match.quality] }}
    >
      <div className="custom-anchor-info-title">{labels.title}</div>
      {rows.map(([label, value, warn]) => (
        <div className="custom-anchor-info-row" key={label}>
          <span className="custom-anchor-info-label">{label}</span>
          <span className={warn ? "custom-anchor-info-warn" : undefined}>{value}</span>
        </div>
      ))}
    </div>
  );
}
