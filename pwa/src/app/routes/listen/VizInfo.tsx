import type React from "react";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTime } from "@/shared/utils/format";
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/shared/autocanonizer/AutocanonizerViz";
import type { PlayMode } from "./types";

export function VizInfo({
  vizTitleRef,
  playMode,
  autocanonizerMainSeconds,
  autocanonizerOtherSeconds,
  trackDurationSeconds,
  listenSeconds,
  beatsLabel,
  beatsPlayed,
  bringItHomeMode,
}: {
  vizTitleRef: React.RefCallback<HTMLDivElement>;
  playMode: PlayMode;
  autocanonizerMainSeconds: number;
  autocanonizerOtherSeconds: number;
  trackDurationSeconds: number;
  listenSeconds: number;
  beatsLabel: string;
  beatsPlayed: number;
  bringItHomeMode: boolean;
}) {
  const { t } = useTranslation();
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
            style={{ color: AUTOCANONIZER_MAIN_COLOR }}
          >
            {formatTime(autocanonizerMainSeconds)}
          </span>
          <span aria-hidden="true">–</span>
          <span
            id="autocanonizer-other-time"
            style={{ color: AUTOCANONIZER_OTHER_COLOR }}
          >
            {formatTime(autocanonizerOtherSeconds)}
          </span>
          <span aria-hidden="true">/</span>
          <span id="autocanonizer-total-time">
            {formatTime(trackDurationSeconds)}
          </span>
        </span>
        <span className="viz-meta-stats">
          <span>{t("listen.listenTime")}</span>
          <span>{formatDuration(listenSeconds)}</span>
          <span className={`viz-divider ${playMode === "autocanonizer" ? "is-hidden" : ""}`}>·</span>
          <span className={playMode === "autocanonizer" ? "is-hidden" : ""}>{beatsLabel}</span>
          <span className={playMode === "autocanonizer" ? "is-hidden" : ""}>{beatsPlayed}</span>
        </span>
        {playMode === "jukebox" && bringItHomeMode ? (
          <span className="bring-home-fullscreen-note">· Bringing it on home</span>
        ) : null}
      </div>
    </div>
  );
}
