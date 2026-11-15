import React from "react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@forever-jukebox/shared/ui/format";
import { formatTime } from "@/shared/utils/format";
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/shared/autocanonizer/AutocanonizerViz";
import type { PlaybackCounters, PlaybackCounterValues } from "./playbackCounters";
import type { PlayMode } from "@forever-jukebox/shared/constants/playback";

function setText(node: HTMLSpanElement | null, text: string) {
  if (node && node.textContent !== text) {
    node.textContent = text;
  }
}

export function VizInfo({
  vizTitleRef,
  playMode,
  counters,
  wubMachineDurationSeconds,
  trackDurationSeconds,
  beatsLabel,
  bringItHomeMode,
}: {
  vizTitleRef: React.RefCallback<HTMLDivElement>;
  playMode: PlayMode;
  counters: PlaybackCounters;
  wubMachineDurationSeconds: number;
  trackDurationSeconds: number;
  beatsLabel: string;
  bringItHomeMode: boolean;
}) {
  const { t } = useTranslation();
  const mainTimeRef = React.useRef<HTMLSpanElement | null>(null);
  const otherTimeRef = React.useRef<HTMLSpanElement | null>(null);
  const wubTimeRef = React.useRef<HTMLSpanElement | null>(null);
  const listenTimeRef = React.useRef<HTMLSpanElement | null>(null);
  const beatsPlayedRef = React.useRef<HTMLSpanElement | null>(null);

  // Counters change several times a second; they reach the DOM directly,
  // so playback causes no React commit.
  React.useLayoutEffect(() => {
    const write = (values: PlaybackCounterValues) => {
      setText(mainTimeRef.current, formatTime(values.autocanonizerMainSeconds));
      setText(otherTimeRef.current, formatTime(values.autocanonizerOtherSeconds));
      setText(wubTimeRef.current, formatTime(values.wubMachineSeconds));
      setText(listenTimeRef.current, formatDuration(values.listenSeconds));
      setText(beatsPlayedRef.current, String(values.beatsPlayed));
    };
    write(counters.get());
    return counters.subscribe(write);
  }, [counters]);

  const hideBeats = playMode !== "jukebox";
  return (
    <div className="viz-info">
      <div className="viz-title" id="viz-now-playing" ref={vizTitleRef}></div>
      <div className="viz-meta">
        <span
          id="autocanonizer-times"
          className={`autocanonizer-times ${playMode === "autocanonizer" ? "" : "is-hidden"}`}
        >
          <span
            id="autocanonizer-main-time"
            ref={mainTimeRef}
            style={{ color: AUTOCANONIZER_MAIN_COLOR }}
          ></span>
          <span aria-hidden="true">–</span>
          <span
            id="autocanonizer-other-time"
            ref={otherTimeRef}
            style={{ color: AUTOCANONIZER_OTHER_COLOR }}
          ></span>
          <span aria-hidden="true">/</span>
          <span id="autocanonizer-total-time">
            {formatTime(trackDurationSeconds)}
          </span>
        </span>
        <span
          id="wubmachine-times"
          className={`autocanonizer-times ${playMode === "wubmachine" ? "" : "is-hidden"}`}
        >
          <span id="wubmachine-time" ref={wubTimeRef}></span>
          <span aria-hidden="true">/</span>
          <span id="wubmachine-total-time">
            {formatTime(wubMachineDurationSeconds)}
          </span>
        </span>
        <span className="viz-meta-stats">
          <span>{t("listen.listenTime")}</span>
          <span ref={listenTimeRef}></span>
          <span className={`viz-divider ${hideBeats ? "is-hidden" : ""}`}>·</span>
          <span className={hideBeats ? "is-hidden" : ""}>{beatsLabel}</span>
          <span className={hideBeats ? "is-hidden" : ""} ref={beatsPlayedRef}></span>
        </span>
        {playMode === "jukebox" && bringItHomeMode ? (
          <span className="bring-home-fullscreen-note">· Bringing it on home</span>
        ) : null}
      </div>
    </div>
  );
}
