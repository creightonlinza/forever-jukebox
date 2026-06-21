import { useLayoutEffect, useRef } from "react";
import {
  AUTOCANONIZER_MAIN_COLOR,
  AUTOCANONIZER_OTHER_COLOR,
} from "@forever-jukebox/engine/autocanonizer/AutocanonizerViz";
import { formatCursorTime, formatPlaybackTitle } from "../../format";
import { useMarquee } from "../../hooks/useMarquee";
import { useAppStore } from "../../store";

// Viz-bottom track info: marquee title, listen time and beat counters.
// Rendered into the .viz-info container.
export function VizInfo() {
  const trackTitle = useAppStore((s) => s.trackTitle);
  const trackArtist = useAppStore((s) => s.trackArtist);
  const playMode = useAppStore((s) => s.playMode);
  const audioMode = useAppStore((s) => s.jukeboxAudioMode);
  const bringItHomeMode = useAppStore((s) => s.bringItHomeMode);
  const trackDurationSec = useAppStore((s) => s.trackDurationSec);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const listenTimeRef = useRef<HTMLSpanElement | null>(null);
  const beatsPlayedRef = useRef<HTMLSpanElement | null>(null);
  const mainCursorTimeRef = useRef<HTMLSpanElement | null>(null);
  const otherCursorTimeRef = useRef<HTMLSpanElement | null>(null);

  // listenTimeText (~5Hz) and beatsPlayedText (engine-rate) change far too
  // often to drive React renders — each would re-run the title/marquee work
  // several times a second during playback. Write them straight to their DOM
  // nodes through a transient store subscription instead, so VizInfo only
  // re-renders when the track metadata around them actually changes.
  useLayoutEffect(() => {
    const seed = useAppStore.getState();
    if (listenTimeRef.current) {
      listenTimeRef.current.textContent = seed.listenTimeText;
    }
    if (beatsPlayedRef.current) {
      beatsPlayedRef.current.textContent = seed.beatsPlayedText;
    }
    if (mainCursorTimeRef.current) {
      mainCursorTimeRef.current.textContent = formatCursorTime(
        seed.autocanonizerMainSeconds,
      );
    }
    if (otherCursorTimeRef.current) {
      otherCursorTimeRef.current.textContent = formatCursorTime(
        seed.autocanonizerOtherSeconds,
      );
    }
    return useAppStore.subscribe((state, prev) => {
      if (
        state.listenTimeText !== prev.listenTimeText &&
        listenTimeRef.current
      ) {
        listenTimeRef.current.textContent = state.listenTimeText;
      }
      if (
        state.beatsPlayedText !== prev.beatsPlayedText &&
        beatsPlayedRef.current
      ) {
        beatsPlayedRef.current.textContent = state.beatsPlayedText;
      }
      if (
        state.autocanonizerMainSeconds !== prev.autocanonizerMainSeconds &&
        mainCursorTimeRef.current
      ) {
        mainCursorTimeRef.current.textContent = formatCursorTime(
          state.autocanonizerMainSeconds,
        );
      }
      if (
        state.autocanonizerOtherSeconds !== prev.autocanonizerOtherSeconds &&
        otherCursorTimeRef.current
      ) {
        otherCursorTimeRef.current.textContent = formatCursorTime(
          state.autocanonizerOtherSeconds,
        );
      }
    });
  }, []);

  const displayTitle =
    trackTitle || trackArtist
      ? (() => {
          const withSuffix = formatPlaybackTitle(
            trackTitle ?? "Unknown",
            playMode,
            audioMode,
          );
          return trackArtist ? `${withSuffix} — ${trackArtist}` : withSuffix;
        })()
      : "The Forever Jukebox";
  useMarquee(titleRef, displayTitle);

  const isCanonizer = playMode === "autocanonizer";
  const bringHomeVisible = playMode === "jukebox" && bringItHomeMode;
  const beatsLabel =
    audioMode === "cowbell" ? "Total Cowbells:" : "Total Beats:";

  return (
    <>
      <div className="viz-title" id="viz-now-playing" ref={titleRef}></div>
      <div className="viz-meta">
        <span
          id="autocanonizer-times"
          className={
            isCanonizer ? "autocanonizer-times" : "autocanonizer-times is-hidden"
          }
        >
          <span
            id="autocanonizer-main-time"
            ref={mainCursorTimeRef}
            style={{ color: AUTOCANONIZER_MAIN_COLOR }}
          ></span>
          <span aria-hidden="true">–</span>
          <span
            id="autocanonizer-other-time"
            ref={otherCursorTimeRef}
            style={{ color: AUTOCANONIZER_OTHER_COLOR }}
          ></span>
          <span aria-hidden="true">/</span>
          <span id="autocanonizer-total-time">
            {formatCursorTime(trackDurationSec ?? 0)}
          </span>
        </span>
        <span className="viz-meta-stats">
          <span>Listen Time:</span>
          <span id="listen-time" ref={listenTimeRef}></span>
          <span
            id="viz-beats-divider"
            className={isCanonizer ? "viz-divider is-hidden" : "viz-divider"}
          >
            ·
          </span>
          <span
            id="viz-beats-label"
            className={isCanonizer ? "is-hidden" : undefined}
          >
            {beatsLabel}
          </span>
          <span
            id="beats-played"
            className={isCanonizer ? "is-hidden" : undefined}
            ref={beatsPlayedRef}
          ></span>
        </span>
        <span
          id="bring-home-fullscreen-label"
          className={
            bringHomeVisible
              ? "bring-home-fullscreen-note"
              : "bring-home-fullscreen-note is-hidden"
          }
        >
          · Bringing it on home
        </span>
      </div>
    </>
  );
}
