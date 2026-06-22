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
import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation();
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
      setCachedTrackError(t("home.loadFailed"));
      setCachedTracks([]);
    } finally {
      setIsLoadingCachedTracks(false);
    }
  }, [t]);

  useEffect(() => {
    if (location.pathname !== "/") {
      return;
    }
    refreshCachedTracks().catch((err) => {
      console.warn(`Failed to refresh cached tracks: ${String(err)}`);
    });
  }, [location.pathname, refreshCachedTracks]);

  const onDeleteCachedTrack = useCallback(async (fingerprint: string) => {
    setDeletingFingerprint(fingerprint);
    setCachedTrackError(null);
    try {
      const cache = createAnalysisCache();
      await cache.clear(fingerprint);
      setCachedTracks((prev) => prev.filter((track) => track.fingerprint !== fingerprint));
    } catch {
      setCachedTrackError(t("home.deleteFailed"));
    } finally {
      setDeletingFingerprint((current) => (current === fingerprint ? null : current));
    }
  }, [t]);

  const handleDeleteCachedTrack = useCallback(
    (fingerprint: string) => {
      onDeleteCachedTrack(fingerprint).catch((err) => {
        console.warn(`Failed to delete cached analysis: ${String(err)}`);
      });
    },
    [onDeleteCachedTrack],
  );

  return (
    <section className="panel home-panel">
      <DropZone onFile={handleFile} accept="audio/*" />
      <div className="cached-tracks">
        <h2 className="cached-tracks__title">
          <span>{t("home.cachedAnalysis")}</span>
          <span className="cached-tracks__title-hint">
            {t("home.cachedHint")}
          </span>
        </h2>
        {isLoadingCachedTracks ? <p>{t("home.loadingCached")}</p> : null}
        {!isLoadingCachedTracks && cachedTrackError ? (
          <p>{cachedTrackError}</p>
        ) : null}
        {!isLoadingCachedTracks && !cachedTrackError && cachedTracks.length === 0 ? (
          <p>{t("home.noCached")}</p>
        ) : null}
        {!isLoadingCachedTracks && !cachedTrackError && cachedTracks.length > 0 ? (
          <ul className="cached-tracks__list">
            {cachedTracks.map((track) => {
              const title =
                track.title ??
                t("home.cachedTrack", {
                  id: track.fingerprint.slice(0, 8),
                });
              const label = track.artist
                ? `${title} — ${track.artist}`
                : title;
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
                    onClick={() => handleDeleteCachedTrack(track.fingerprint)}
                    disabled={isDeleting}
                    aria-label={t("home.deleteNamed", { label })}
                    title={t("home.deleteTitle")}
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
