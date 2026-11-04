import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CachedAnalysisTrack,
  deleteCachedAnalysis,
  listCachedAnalysisTracks,
} from "@/core/infrastructure/cache/analysisCache";
import {
  deleteFileHandle,
  getFileHandle,
  readFileFromHandle,
} from "@/core/infrastructure/cache/fileHandleStore";
import { computeFingerprint } from "@/shared/utils/fingerprint";
import { formatDuration } from "@/shared/utils/format";
import { DropZone, useAudioFilePicker } from "@/ui/components/DropZone";
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
  const [reopenFailed, setReopenFailed] = useState(false);

  const handleFile = useCallback(
    (file: File, handle: FileSystemFileHandle | null) => {
      setReopenFailed(false);
      setFile(file, handle);
      navigate("/listen");
    },
    [navigate, setFile],
  );
  const { open: openCachedTrackPicker, input: cachedTrackPickerInput } =
    useAudioFilePicker(handleFile);

  // Reopens the track's file through its stored handle; without one, or when
  // the browser can't reach the file, asks the user to pick it.
  const handleOpenCachedTrack = useCallback(
    async (fingerprint: string) => {
      setReopenFailed(false);
      const handle = await getFileHandle(fingerprint).catch(() => null);
      const file = handle ? await readFileFromHandle(handle) : null;
      // Reading the file's head can still fail if it moved since getFile().
      const fileFingerprint = file
        ? await computeFingerprint(file).catch(() => null)
        : null;
      if (handle && file && fileFingerprint) {
        // An edited file fingerprints differently, so this row's handle no
        // longer leads back to its analysis; the file plays as a new track.
        if (fileFingerprint !== fingerprint) {
          deleteFileHandle(fingerprint).catch((err: unknown) => {
            console.warn(`File handle delete failed: ${String(err)}`);
          });
        }
        handleFile(file, handle);
        return;
      }
      // A permission prompt can outlast the click's user activation, which
      // the picker needs to open.
      if (navigator.userActivation?.isActive === false) {
        setReopenFailed(true);
        return;
      }
      await openCachedTrackPicker();
    },
    [handleFile, openCachedTrackPicker],
  );

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
      await deleteCachedAnalysis(fingerprint);
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
      <DropZone onFile={handleFile} />
      <div className="cached-tracks">
        <h2 className="cached-tracks__title">
          <span>{t("home.cachedAnalysis")}</span>
          <span className="cached-tracks__title-hint">
            {t("home.cachedHint")}
          </span>
        </h2>
        {reopenFailed ? <p>{t("home.reopenFailed")}</p> : null}
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
                  <button
                    className="cached-tracks__content"
                    type="button"
                    onClick={() => {
                      handleOpenCachedTrack(track.fingerprint).catch((err) => {
                        console.warn(`Failed to open cached track: ${String(err)}`);
                      });
                    }}
                  >
                    <span className="cached-tracks__name" title={label}>
                      {label}
                    </span>
                    {details ? (
                      <span className="cached-tracks__meta">{details}</span>
                    ) : null}
                  </button>
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
      {cachedTrackPickerInput}
    </section>
  );
}
