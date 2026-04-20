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
          The Forever Jukebox is an open-source modernization of Paul Lamere’s{" "}
          <a
            href="https://musicmachinery.com/2012/11/12/the-infinite-jukebox/"
            target="_blank"
            rel="noreferrer"
          >
            Infinite Jukebox
          </a>{" "}
          and{" "}
          <a
            href="https://musicmachinery.com/2014/03/18/how-the-autocanonizer-works/"
            target="_blank"
            rel="noreferrer"
          >
            Autocanonizer
          </a>{" "}
          — rebuilt from the ground up by{" "}
          <a href="https://creighton.dev" target="_blank" rel="noreferrer">
            Creighton Linza
          </a>
          . It generates a forever-evolving version of any song.
        </p>

        <h2>How does it work?</h2>
        <p>
          The app analyzes your provided audio to estimate beats, segments, and
          related features. Those features drive beat-synchronous playback. On
          each beat, the player may jump to a different, sonically similar point
          based on timbre, loudness, segment duration, and beat position. The
          visualization maps the possible jump paths.
          <br />
          <br />
          The full source code is available in the{" "}
          <a
            href="https://github.com/creightonlinza/forever-jukebox/"
            target="_blank"
            rel="noreferrer"
          >
            forever-jukebox
          </a>{" "}
          repository.
        </p>

        <h2>How can I tune the Jukebox?</h2>
        <ul>
          <li>
            Open the Tune panel to adjust thresholds and branch probability.
          </li>
          <li>Use the checkboxes to allow or restrict certain branch types.</li>
          <li>Select a branch in the visualization and delete it.</li>
        </ul>

        <h2>Where is analysis stored?</h2>
        <p>
          Analysis is stored locally in your browser. You can clear individual
          track analysis on the Home screen, or all cached analysis by clicking
          the button below:
        </p>
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
