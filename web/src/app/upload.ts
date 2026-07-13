import type { AppContext } from "./context";
import { startUrlAnalysis, uploadAudio } from "./api";
import { getLoadGeneration, isStaleLoad, resetForNewTrack } from "./playback";
import { useAppStore } from "./store";
import {
  formatErrorForDisplay,
  inferSourceProviderFromUrl,
} from "./errorDisplay";
import type { PlaylistTrack } from "./playlist";
import { setLoadingProgress, showToast } from "./ui";
import i18n from "./i18n";

// Upload flows. The React Search panel owns the inputs/busy state and calls
// these with values; `onAccepted` fires when the job is accepted (before
// polling) — the point at which the input should be cleared. Static helpers
// (toast, api, reset, url) are imported directly; only the runtime-bound
// context and job/track callbacks are injected.
export type UploadDeps = {
  context: AppContext;
  pollAnalysisJob: (jobId: string) => Promise<void>;
  onNormalTrackSelected?: (track: PlaylistTrack) => void;
};

function formatMinutes(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(Math.trunc(rounded));
  }
  return String(rounded);
}

function maxTrackLengthMessage(minutes: number): string {
  return i18n.t("search.maxTrackLength", {
    minutes: formatMinutes(minutes),
  });
}

function normalizeUploadedSourceType(
  sourceProvider: string,
): PlaylistTrack["sourceType"] {
  if (sourceProvider === "soundcloud" || sourceProvider === "bandcamp") {
    return sourceProvider;
  }
  return sourceProvider === "youtube" ? "youtube" : "upload";
}

async function probeAudioDurationSeconds(file: File): Promise<number | null> {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number | null>((resolve) => {
      const audio = new Audio();
      const cleanup = () => {
        audio.removeAttribute("src");
        audio.load();
      };
      const onLoaded = () => {
        const value = Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : null;
        cleanup();
        resolve(value);
      };
      const onError = () => {
        cleanup();
        resolve(null);
      };
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.src = objectUrl;
    });
    return duration;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function normalizeSupportedSourceUrl(value: string) {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const allowed =
    host === "youtu.be" ||
    host.endsWith("youtube.com") ||
    host.endsWith("soundcloud.com") ||
    host.endsWith("bandcamp.com");
  if (!allowed) {
    return null;
  }
  url.hash = "";
  return url.toString();
}

export async function uploadAudioFile(
  deps: UploadDeps,
  file: File | null | undefined,
  onAccepted?: () => void,
) {
  const { context } = deps;
  const config = useAppStore.getState().appConfig;
  if (!config?.allow_user_upload) {
    showToast(i18n.t("upload.disabled"));
    return;
  }
  if (!file) {
    showToast(i18n.t("upload.chooseFile"));
    return;
  }
  if (config.max_upload_size && file.size > config.max_upload_size) {
    showToast(
      i18n.t("upload.fileTooLarge", {
        size: Math.round(config.max_upload_size / (1024 * 1024)),
      }),
    );
    return;
  }
  const maxTrackLengthMinutes = config.max_track_length;
  if (
    typeof maxTrackLengthMinutes === "number" &&
    Number.isFinite(maxTrackLengthMinutes) &&
    maxTrackLengthMinutes > 0
  ) {
    const durationSeconds = await probeAudioDurationSeconds(file);
    if (
      typeof durationSeconds === "number" &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > maxTrackLengthMinutes * 60
    ) {
      showToast(maxTrackLengthMessage(maxTrackLengthMinutes), {
        icon: "error",
        tone: "error",
      });
      return;
    }
  }
  try {
    const generation = getLoadGeneration();
    const response = await uploadAudio(file);
    // The user moved on to another track while the upload ran; the job is
    // accepted server-side but must not hijack the newer session.
    if (isStaleLoad(generation)) {
      return;
    }
    if (!response?.id) {
      throw new Error("Upload failed");
    }
    deps.onNormalTrackSelected?.({
      id: response.id,
      sourceType: "upload",
      title: file.name || i18n.t("common.untitled"),
      artist: "",
      duration: null,
      tuningParams: null,
    });
    resetForNewTrack(context);
    useAppStore.setState({ lastJobId: response.id });
    useAppStore.setState({ pendingAutoFavoriteId: response.id });
    useAppStore.setState({ lastTrackId: response.id });
    useAppStore.setState({ lastSourceId: null });
    useAppStore.setState({ lastSourceProvider: "upload" });
    useAppStore.setState({ audioLoaded: false });
    useAppStore.setState({ analysisLoaded: false });
    useAppStore.getState().navigateToTrackWithState(response.id, {
      replace: true,
      tuningParams: null,
    });
    onAccepted?.();
    useAppStore.getState().setActiveTab("play");
    setLoadingProgress(context, null, () => i18n.t("common.queued"));
    await deps.pollAnalysisJob(response.id);
  } catch (err) {
    const trackTooLong =
      (err as Error & { code?: string }).code === "track_too_long";
    if (trackTooLong) {
      const maxTrackLength = config?.max_track_length;
      const fallbackLimit =
        typeof maxTrackLength === "number" &&
          Number.isFinite(maxTrackLength) &&
          maxTrackLength > 0
          ? maxTrackLength
          : null;
      showToast(
        formatErrorForDisplay(err) ||
          (fallbackLimit !== null
            ? maxTrackLengthMessage(fallbackLimit)
            : i18n.t("upload.trackTooLong")),
        {
          icon: "error",
          tone: "error",
        },
      );
      return;
    }
    showToast(i18n.t("upload.failedWithError", {
      error: formatErrorForDisplay(err),
    }), {
      icon: "error",
      tone: "error",
    });
  }
}

export async function uploadFromUrl(
  deps: UploadDeps,
  raw: string,
  onAccepted?: () => void,
) {
  const { context } = deps;
  const config = useAppStore.getState().appConfig;
  const allowUserUrl = Boolean(config?.allow_user_url);
  if (!allowUserUrl) {
    showToast(i18n.t("upload.urlDisabled"));
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  const sourceUrl = normalizeSupportedSourceUrl(trimmed);
  if (!sourceUrl) {
    showToast(i18n.t("upload.invalidUrl"));
    return;
  }
  const requestedSourceProvider = inferSourceProviderFromUrl(sourceUrl);
  try {
    const generation = getLoadGeneration();
    const response = await startUrlAnalysis({
      url: sourceUrl,
    });
    if (isStaleLoad(generation)) {
      return;
    }
    const sourceProvider = response?.source_provider;
    if (response?.status === "failed") {
      showToast(
        formatErrorForDisplay(response.error, {
          sourceProvider: sourceProvider ?? requestedSourceProvider,
          errorCode: response.error_code,
          fallback: i18n.t("upload.failed"),
        }),
        { icon: "error", tone: "error" },
      );
      return;
    }
    if (!response?.id || !sourceProvider) {
      throw new Error("Upload failed");
    }
    const listenId = response.id;
    const playlistSourceType = normalizeUploadedSourceType(sourceProvider);
    deps.onNormalTrackSelected?.({
      id: listenId,
      sourceType: playlistSourceType,
      title: i18n.t("common.untitled"),
      artist: "",
      duration: null,
      tuningParams: null,
    });
    resetForNewTrack(context);
    useAppStore.setState({ lastTrackId: listenId });
    useAppStore.setState({ lastJobId: response.id });
    useAppStore.setState({
      lastSourceId:
        typeof response.source_id === "string" ? response.source_id : null,
    });
    useAppStore.setState({ lastSourceProvider: sourceProvider });
    useAppStore.setState({ pendingAutoFavoriteId: listenId });
    onAccepted?.();
    useAppStore.getState().navigateToTrackWithState(listenId, {
      replace: true,
      tuningParams: null,
    });
    useAppStore.getState().setActiveTab("play");
    setLoadingProgress(context, null, () => i18n.t("common.fetchingAudio"));
    await deps.pollAnalysisJob(response.id);
  } catch (err) {
    const trackTooLong =
      (err as Error & { code?: string }).code === "track_too_long";
    if (trackTooLong) {
      const maxTrackLength = config?.max_track_length;
      const fallbackLimit =
        typeof maxTrackLength === "number" &&
          Number.isFinite(maxTrackLength) &&
          maxTrackLength > 0
          ? maxTrackLength
          : null;
      showToast(
        formatErrorForDisplay(err, {
          sourceProvider: requestedSourceProvider,
        }) ||
          (fallbackLimit !== null
            ? maxTrackLengthMessage(fallbackLimit)
            : i18n.t("upload.trackTooLong")),
        {
          icon: "error",
          tone: "error",
        },
      );
      return;
    }
    showToast(
      formatErrorForDisplay(err, {
        sourceProvider: requestedSourceProvider,
        fallback: i18n.t("upload.failed"),
      }),
      { icon: "error", tone: "error" },
    );
  }
}

// Module singleton: init registers the upload flow's deps so SearchPanel
// calls these without the bridge prop. (Phase 4)
let uploadDeps: UploadDeps | null = null;

export function setUploadRuntime(deps: UploadDeps): void {
  uploadDeps = deps;
}

export function uploadFile(
  file: File | null | undefined,
  onAccepted?: () => void,
): Promise<void> {
  if (!uploadDeps) {
    return Promise.resolve();
  }
  return uploadAudioFile(uploadDeps, file, onAccepted);
}

export function uploadUrl(raw: string, onAccepted?: () => void): Promise<void> {
  if (!uploadDeps) {
    return Promise.resolve();
  }
  return uploadFromUrl(uploadDeps, raw, onAccepted);
}
