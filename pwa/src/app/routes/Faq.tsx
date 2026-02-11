import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAllAnalysisCache,
  getAnalysisCacheBytes,
} from "@/core/infrastructure/cache/analysisCache";

function formatMegabytes(bytes: number) {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  const rounded = mb.toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

export function Faq() {
  const [usageBytes, setUsageBytes] = useState(0);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  const usageMb = useMemo(() => formatMegabytes(usageBytes), [usageBytes]);

  const refreshUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    try {
      const bytes = await getAnalysisCacheBytes();
      setUsageBytes(bytes);
    } catch (err) {
      console.warn(`Failed to load cache usage: ${String(err)}`);
      setUsageBytes(0);
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const onClearCache = useCallback(async () => {
    setIsClearing(true);
    setCacheMessage(null);
    try {
      await clearAllAnalysisCache();
      await refreshUsage();
      setCacheMessage("Analysis cache cleared.");
    } catch (err) {
      console.warn(`Failed to clear analysis cache: ${String(err)}`);
      setCacheMessage("Unable to clear analysis cache.");
    } finally {
      setIsClearing(false);
    }
  }, [refreshUsage]);

  return (
    <section className="panel panel--faq">
      <h1>FAQ</h1>
      <div className="faq">
        <h2>What is The Forever Jukebox?</h2>
        <p>
          The Forever Jukebox is an open-source modernization of Paul Lamere’s
          Infinite Jukebox and Autocanonizer — rebuilt from the ground up by
          Creighton Linza. It generates a forever-evolving version of any song.
        </p>

        <h2>How does it work?</h2>
        <p>
          The app analyzes your audio locally to estimate beats, segments, and
          related features. Those features drive beat-synchronous playback. On
          each beat, the player may jump to a different, sonically similar point
          based on timbre, loudness, segment duration, and beat position. The
          visualization maps the possible jump paths.
        </p>

        <h2>Why does the first analysis take time?</h2>
        <p>
          Beat tracking and feature extraction are compute-heavy. The first run
          caches the analysis so reloading the same file is instant.
        </p>

        <h2>Where is analysis stored?</h2>
        <p>
          Analysis is stored locally in your browser (OPFS when available,
          otherwise IndexedDB).
        </p>

        <h2>How can I tune the Jukebox?</h2>
        <ul>
          <li>Open the Tune panel to adjust thresholds and branch probability.</li>
          <li>Use the checkboxes to allow or restrict certain branch types.</li>
          <li>Select a branch in the visualization and delete it.</li>
        </ul>

        <h2>Credits</h2>
        <ul>
          <li>
            Original inspiration: Paul Lamere and the{" "}
            <a
              href="https://musicmachinery.com/2012/11/12/the-infinite-jukebox/"
              target="_blank"
              rel="noreferrer"
            >
              Infinite Jukebox
            </a>
            .
          </li>
          <li>
            The Forever Jukebox:{" "}
            <a href="https://creighton.dev" target="_blank" rel="noreferrer">
              Creighton Linza
            </a>
            .
          </li>
          <li>
            madmom WASM port:{" "}
            <a href="https://github.com/creightonlinza/madmom-beats-port">
              creightonlinza/madmom-beats-port
            </a>
            .
          </li>
          <li>Essentia: audio features and DSP toolkits.</li>
        </ul>

        <h2>Analysis Cache</h2>
        <button
          className="tab-btn"
          type="button"
          disabled={isClearing || isLoadingUsage || usageBytes <= 0}
          onClick={onClearCache}
        >
          {isClearing ? "Clearing..." : `Clear ${usageMb}MB`}
        </button>
        {cacheMessage ? <p>{cacheMessage}</p> : null}
      </div>
    </section>
  );
}
