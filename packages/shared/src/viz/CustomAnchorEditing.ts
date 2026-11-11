import type { JukeboxEngine } from "../engine/JukeboxEngine";
import {
  nudgeCustomAnchorEnd,
  snapCustomAnchorEnd,
  startingCustomAnchor,
  type CustomAnchor,
  type CustomAnchorEnd,
} from "../engine/selection";
import type { QuantumBase } from "../engine/types";
import type { AnchorEditState } from "./JukeboxViz";

// Each commit re-arms the player's anchor swap, so key repeats commit once they settle.
const NUDGE_COMMIT_DELAY_MS = 300;

// The app owns the edit state; the host reads and writes it and refreshes the app after an anchor change.
export type CustomAnchorEditHost = {
  engine: Pick<
    JukeboxEngine,
    "getActiveAnchor" | "setCustomAnchor" | "setUserAnchorEdge"
  >;
  beats: () => readonly QuantumBase[];
  getEdit: () => AnchorEditState | null;
  // Updates the app state and the viz handles together.
  setEdit: (state: AnchorEditState | null) => void;
  onAnchorChanged: () => void;
};

function samePair(a: CustomAnchor | null, b: CustomAnchor): boolean {
  return a !== null && a.src === b.src && a.dest === b.dest;
}

export class CustomAnchorEditing {
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  private initialEdit(host: CustomAnchorEditHost): AnchorEditState | null {
    const start = startingCustomAnchor(host.engine.getActiveAnchor(), host.beats().length);
    return start ? { ...start, active: "src" } : null;
  }

  private cancelNudge(): boolean {
    if (this.nudgeTimer === null) {
      return false;
    }
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
    return true;
  }

  // A pair equal to the anchor in force changes nothing, so a click on a handle keeps a pinned or default anchor.
  private commit(host: CustomAnchorEditHost, pair: CustomAnchor) {
    if (samePair(host.engine.getActiveAnchor(), pair)) {
      return;
    }
    if (host.engine.setCustomAnchor(pair.src, pair.dest)) {
      host.onAnchorChanged();
    }
  }

  // Drops a pending nudge commit, for an editor whose app is going away.
  dispose() {
    this.cancelNudge();
  }

  canStart(host: CustomAnchorEditHost): boolean {
    return this.initialEdit(host) !== null;
  }

  start(host: CustomAnchorEditHost): boolean {
    const edit = this.initialEdit(host);
    if (!edit) {
      return false;
    }
    host.setEdit(edit);
    return true;
  }

  // Leaves edit mode; a nudge still waiting for its commit lands first.
  exit(host: CustomAnchorEditHost) {
    const nudgePending = this.cancelNudge();
    const edit = host.getEdit();
    if (!edit) {
      return;
    }
    if (nudgePending) {
      this.commit(host, edit);
    }
    host.setEdit(null);
  }

  // Leaves edit mode without committing, for loads and resets that replace the anchor.
  discard(host: CustomAnchorEditHost) {
    this.cancelNudge();
    if (host.getEdit()) {
      host.setEdit(null);
    }
  }

  dragChanged(host: CustomAnchorEditHost, state: AnchorEditState) {
    if (host.getEdit()) {
      host.setEdit(state);
    }
  }

  dragCommitted(host: CustomAnchorEditHost, state: AnchorEditState) {
    if (!host.getEdit()) {
      return;
    }
    this.cancelNudge();
    host.setEdit(state);
    this.commit(host, state);
  }

  selectEnd(host: CustomAnchorEditHost, end: CustomAnchorEnd) {
    const edit = host.getEdit();
    if (edit && edit.active !== end) {
      host.setEdit({ ...edit, active: end });
    }
  }

  // Moves the selected end by one beat, or by one bar when byBar is set.
  nudge(host: CustomAnchorEditHost, direction: -1 | 1, byBar: boolean) {
    const edit = host.getEdit();
    const beats = host.beats();
    if (!edit || beats.length === 0) {
      return;
    }
    const next = nudgeCustomAnchorEnd(beats, edit, edit.active, direction, byBar);
    if (samePair(edit, next)) {
      return;
    }
    host.setEdit({ ...next, active: edit.active });
    this.cancelNudge();
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      const latest = host.getEdit();
      if (latest) {
        this.commit(host, latest);
      }
    }, NUDGE_COMMIT_DELAY_MS);
  }

  // Moves the selected end to the best-matching beat within one bar and commits it.
  snap(host: CustomAnchorEditHost) {
    const edit = host.getEdit();
    const beats = host.beats();
    if (!edit || beats.length === 0) {
      return;
    }
    const next = snapCustomAnchorEnd(beats, edit, edit.active);
    if (samePair(edit, next)) {
      return;
    }
    this.cancelNudge();
    const nextEdit = { ...next, active: edit.active };
    host.setEdit(nextEdit);
    this.commit(host, nextEdit);
  }

  // Returns to the track's default anchor and keeps the editor open on it.
  reset(host: CustomAnchorEditHost) {
    this.cancelNudge();
    host.engine.setUserAnchorEdge(null);
    host.onAnchorChanged();
    if (host.getEdit()) {
      host.setEdit(this.initialEdit(host));
    }
  }
}
