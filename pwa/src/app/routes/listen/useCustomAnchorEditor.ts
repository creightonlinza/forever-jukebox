import * as React from "react";
import type { TFunction } from "i18next";
import type { CustomAnchorEnd, JukeboxEngine, QuantumBase } from "@forever-jukebox/shared";
import type { JukeboxController } from "@forever-jukebox/shared/viz/JukeboxController";
import {
  CustomAnchorEditing,
  type CustomAnchorEditHost,
} from "@forever-jukebox/shared/viz/CustomAnchorEditing";
import type { AnchorEditState } from "@forever-jukebox/shared/viz/JukeboxViz";
import type { CustomAnchorLabels } from "@forever-jukebox/shared/ui/CustomAnchorEditor";
import { formatDuration } from "@/shared/utils/format";

export function customAnchorLabels(t: TFunction): CustomAnchorLabels {
  return {
    setCustomAnchor: t("listen.setCustomAnchor"),
    title: t("listen.customAnchorTitle"),
    hint: t("listen.customAnchorHint"),
    from: t("listen.customAnchorFrom"),
    to: t("listen.customAnchorTo"),
    beat: (beat, seconds) =>
      t("listen.customAnchorBeat", { beat, time: formatDuration(seconds) }),
    snap: t("listen.customAnchorSnap"),
    snapHint: t("listen.customAnchorSnapHint"),
    reset: t("listen.customAnchorReset"),
    done: t("listen.customAnchorDone"),
    match: t("listen.customAnchorMatch"),
    barPosition: t("listen.customAnchorBarPosition"),
    loopLabel: t("listen.customAnchorLoopLabel"),
    loop: (beats, seconds, bars) => {
      const time = formatDuration(seconds);
      return bars === null
        ? t("listen.customAnchorLoop", { beats, time })
        : t("listen.customAnchorLoopBars", { bars, beats, time });
    },
  };
}

export type CustomAnchorEditor = {
  edit: AnchorEditState | null;
  isEditing: () => boolean;
  start: () => boolean;
  exit: () => void;
  discard: () => void;
  dragChanged: (state: AnchorEditState) => void;
  dragCommitted: (state: AnchorEditState) => void;
  selectEnd: (end: CustomAnchorEnd) => void;
  nudge: (direction: -1 | 1, byBar: boolean) => void;
  snap: () => void;
  reset: () => void;
};

// React state holds the edit pair; the viz mirrors it for the handles.
export function useCustomAnchorEditor({
  engineRef,
  vizControllerRef,
  getBeats,
  onAnchorChanged,
}: {
  engineRef: React.RefObject<JukeboxEngine | null>;
  vizControllerRef: React.RefObject<JukeboxController | null>;
  // The beats the viz shows, read from the app's cached viz data.
  getBeats: () => readonly QuantumBase[];
  onAnchorChanged: () => void;
}): CustomAnchorEditor {
  const [edit, setEdit] = React.useState<AnchorEditState | null>(null);
  const editRef = React.useRef<AnchorEditState | null>(null);
  const onAnchorChangedRef = React.useRef(onAnchorChanged);
  onAnchorChangedRef.current = onAnchorChanged;
  const getBeatsRef = React.useRef(getBeats);
  getBeatsRef.current = getBeats;
  const [editing] = React.useState(() => new CustomAnchorEditing());

  React.useEffect(() => () => editing.dispose(), [editing]);

  return React.useMemo(() => {
    const setEditState = (state: AnchorEditState | null) => {
      editRef.current = state;
      setEdit(state);
      vizControllerRef.current?.setAnchorEdit(state);
    };
    const currentHost = (): CustomAnchorEditHost | null => {
      const engine = engineRef.current;
      return engine
        ? {
            engine,
            beats: () => getBeatsRef.current(),
            getEdit: () => editRef.current,
            setEdit: setEditState,
            onAnchorChanged: () => onAnchorChangedRef.current(),
          }
        : null;
    };
    const withHost = (action: (host: CustomAnchorEditHost) => void) => {
      const host = currentHost();
      if (host) {
        action(host);
      }
    };
    return {
      edit,
      isEditing: () => editRef.current !== null,
      start: () => {
        const host = currentHost();
        return host ? editing.start(host) : false;
      },
      exit: () => withHost((host) => editing.exit(host)),
      // Closes the editor even when no engine is left to keep an anchor on.
      discard: () => {
        const host = currentHost();
        if (host) {
          editing.discard(host);
        } else if (editRef.current) {
          editing.dispose();
          setEditState(null);
        }
      },
      dragChanged: (state) => withHost((host) => editing.dragChanged(host, state)),
      dragCommitted: (state) => withHost((host) => editing.dragCommitted(host, state)),
      selectEnd: (end) => withHost((host) => editing.selectEnd(host, end)),
      nudge: (direction, byBar) => withHost((host) => editing.nudge(host, direction, byBar)),
      snap: () => withHost((host) => editing.snap(host)),
      reset: () => withHost((host) => editing.reset(host)),
    };
  }, [edit, editing, engineRef, vizControllerRef]);
}
