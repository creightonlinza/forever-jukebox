import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CachedAnalysisTrack,
  createAnalysisCache,
  listCachedAnalysisTracks,
} from "@/core/infrastructure/cache/analysisCache";
import { formatDuration } from "@/shared/utils/format";
import { DropZone } from "@/ui/components/DropZone";
import { SymbolIcon } from "@/ui/components/SymbolIcon";
import { useAppState } from "../state/AppState";

export function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setFile } = useAppState();
  const [cachedTracks, setCachedTracks] = useState<CachedAnalysisTrack[]>([]);
  const [isLoadingCachedTracks, setIsLoadingCachedTracks] = useState(false);
  const [deletingFingerprint, setDeletingFingerprint] = useState<string | null>(null);
  const [cachedTrackError, setCachedTrackError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setFile(file);
    navigate("/listen");
  };

  const refreshCachedTracks = useCallback(async () => {
    setIsLoadingCachedTracks(true);
    setCachedTrackError(null);
    try {
      const tracks = await listCachedAnalysisTracks();
      setCachedTracks(tracks);
    } catch {
      setCachedTrackError("Unable to load cached analysis tracks.");
      setCachedTracks([]);
    } finally {
      setIsLoadingCachedTracks(false);
    }
  }, []);

  useEffect(() => {
    if (location.pathname !== "/") {
      return;
    }
    void refreshCachedTracks();
  }, [location.pathname, refreshCachedTracks]);

  const onDeleteCachedTrack = useCallback(async (fingerprint: string) => {
    setDeletingFingerprint(fingerprint);
    setCachedTrackError(null);
    try {
      const cache = createAnalysisCache();
      await cache.clear(fingerprint);
      setCachedTracks((prev) => prev.filter((track) => track.fingerprint !== fingerprint));
    } catch {
      setCachedTrackError("Unable to delete cached analysis.");
    } finally {
      setDeletingFingerprint((current) => (current === fingerprint ? null : current));
    }
  }, []);

  return (
    <section className="panel home-panel">
      <DropZone onFile={handleFile} accept="audio/*" />
      <div className="cached-tracks">
        <h2 className="cached-tracks__title">
          Cached analysis
          <span className="cached-tracks__title-hint">
            Pick the original audio file to load its cached analysis instantly.
          </span>
        </h2>
        {isLoadingCachedTracks ? <p>Loading cached tracks...</p> : null}
        {!isLoadingCachedTracks && cachedTrackError ? (
          <p>{cachedTrackError}</p>
        ) : null}
        {!isLoadingCachedTracks && !cachedTrackError && cachedTracks.length === 0 ? (
          <p>No cached local analyses yet.</p>
        ) : null}
        {!isLoadingCachedTracks && !cachedTrackError && cachedTracks.length > 0 ? (
          <ul className="cached-tracks__list">
            {cachedTracks.map((track) => {
              const label = track.artist
                ? `${track.title} — ${track.artist}`
                : track.title;
              const details = track.durationSeconds
                ? formatDuration(Math.round(track.durationSeconds))
                : null;
              const isDeleting = deletingFingerprint === track.fingerprint;

              return (
                <li key={track.fingerprint} className="cached-tracks__item">
                  <div className="cached-tracks__content">
                    <span className="cached-tracks__name" title={label}>
                      {label}
                    </span>
                    {details ? (
                      <span className="cached-tracks__meta">{details}</span>
                    ) : null}
                  </div>
                  <button
                    className="cached-tracks__delete"
                    type="button"
                    onClick={() => void onDeleteCachedTrack(track.fingerprint)}
                    disabled={isDeleting}
                    aria-label={`Delete cached analysis for ${label}`}
                    title="Delete cached analysis"
                  >
                    <SymbolIcon className="cached-tracks__delete-icon" name="close" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
