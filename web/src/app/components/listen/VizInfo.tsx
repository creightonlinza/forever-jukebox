import { useRef } from "react";
import { formatPlaybackTitle } from "../../format";
import { useMarquee } from "../../hooks/useMarquee";
import { useAppStore } from "../../store";

// Viz-bottom track info: marquee title, listen time and beat counters.
// Renders via portal into the legacy .viz-info container.
export function VizInfo() {
  const trackTitle = useAppStore((s) => s.trackTitle);
  const trackArtist = useAppStore((s) => s.trackArtist);
  const playMode = useAppStore((s) => s.playMode);
  const audioMode = useAppStore((s) => s.jukeboxAudioMode);
  const listenTimeText = useAppStore((s) => s.listenTimeText);
  const beatsPlayedText = useAppStore((s) => s.beatsPlayedText);
  const bringItHomeMode = useAppStore((s) => s.bringItHomeMode);
  const titleRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <>
      <div className="viz-title" id="viz-now-playing" ref={titleRef}></div>
      <div className="viz-meta">
        <span className="viz-meta-stats">
          <span>Listen Time:</span>
          <span id="listen-time">{listenTimeText}</span>
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
            Total Beats:
          </span>
          <span
            id="beats-played"
            className={isCanonizer ? "is-hidden" : undefined}
          >
            {beatsPlayedText}
          </span>
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
