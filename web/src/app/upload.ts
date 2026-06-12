import type { AppContext, TabId } from "./context";
import { useAppStore } from "./store";
import {
  formatErrorForDisplay,
  inferSourceProviderFromUrl,
} from "./errorDisplay";
import type { PlaylistTrack } from "./playlist";
import type { ToastOptions } from "./ui";

// Upload flows extracted from wire/search.ts. The React Search panel owns
// the inputs/busy state and calls these with values; `onAccepted` fires at
// the point the legacy flow cleared the input (job accepted, before poll).
export type UploadDeps = {
  context: AppContext;
  showToast: (message: string, options?: ToastOptions) => void;
  uploadAudio: (file: File) => Promise<{ id?: string } | null>;
  startUrlAnalysis: (payload: { url: string }) => Promise<{
    id?: string;
    source_id?: string;
    source_provider?: string;
    status?: string;
    error?: string;
    error_code?: string;
  } | null>;
  resetForNewTrack: (context: AppContext) => void;
  setActiveTabWithRefresh: (tabId: TabId) => void;
  setLoadingProgress: (
    context: AppContext,
    progress: number | null,
    message?: string | null,
  ) => void;
  updateTrackUrl: (
    trackId: string,
    replace?: boolean,
    tuningParams?: string | null,
    playMode?: "jukebox" | "autocanonizer",
  ) => void;
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
  return `The maximum track length for this server is ${formatMinutes(minutes)} minutes.`;
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
  const { context, showToast } = deps;
  const config = useAppStore.getState().appConfig;
  if (!config?.allow_user_upload) {
    showToast("Uploads are disabled.");
    return;
  }
  if (!file) {
    showToast("Choose a file to upload.");
    return;
  }
  if (config.max_upload_size && file.size > config.max_upload_size) {
    showToast(
      `File is too large. Max ${Math.round(config.max_upload_size / (1024 * 1024))} MB.`,
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
    const response = await deps.uploadAudio(file);
    if (!response || !response.id) {
      throw new Error("Upload failed");
    }
    deps.onNormalTrackSelected?.({
      id: response.id,
      sourceType: "upload",
      title: file.name || "Untitled",
      artist: "",
      duration: null,
      tuningParams: useAppStore.getState().playMode === "jukebox" ? useAppStore.getState().tuningParams : null,
    });
    deps.resetForNewTrack(context);
    useAppStore.setState({ lastJobId: response.id });
    useAppStore.setState({ pendingAutoFavoriteId: response.id });
    useAppStore.setState({ lastTrackId: response.id });
    useAppStore.setState({ lastSourceId: null });
    useAppStore.setState({ lastSourceProvider: "upload" });
    useAppStore.setState({ audioLoaded: false });
    useAppStore.setState({ analysisLoaded: false });
    deps.updateTrackUrl(response.id, true, useAppStore.getState().tuningParams, useAppStore.getState().playMode);
    onAccepted?.();
    deps.setActiveTabWithRefresh("play");
    deps.setLoadingProgress(context, null, "Queued");
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
            : "This track exceeds the server max track length."),
        {
          icon: "error",
          tone: "error",
        },
      );
      return;
    }
    showToast(`Upload failed: ${formatErrorForDisplay(err)}`, {
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
  const { context, showToast } = deps;
  const config = useAppStore.getState().appConfig;
  const allowUserUrl = Boolean(config?.allow_user_url);
  if (!allowUserUrl) {
    showToast("URL uploads are disabled.");
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    showToast("Enter a supported URL.");
    return;
  }
  const sourceUrl = normalizeSupportedSourceUrl(trimmed);
  if (!sourceUrl) {
    showToast("Invalid or unsupported URL.");
    return;
  }
  const requestedSourceProvider = inferSourceProviderFromUrl(sourceUrl);
  try {
    const response = await deps.startUrlAnalysis({
      url: sourceUrl,
    });
    const sourceProvider = response?.source_provider;
    if (response?.status === "failed") {
      showToast(
        formatErrorForDisplay(response.error, {
          sourceProvider: sourceProvider ?? requestedSourceProvider,
          errorCode: response.error_code,
          fallback: "Upload failed.",
        }),
        { icon: "error", tone: "error" },
      );
      return;
    }
    if (!response || !response.id || !sourceProvider) {
      throw new Error("Upload failed");
    }
    const listenId = response.id;
    const playlistSourceType =
      sourceProvider === "soundcloud" || sourceProvider === "bandcamp"
        ? sourceProvider
        : sourceProvider === "youtube"
          ? "youtube"
          : "upload";
    deps.onNormalTrackSelected?.({
      id: listenId,
      sourceType: playlistSourceType,
      title: "Untitled",
      artist: "",
      duration: null,
      tuningParams: useAppStore.getState().playMode === "jukebox" ? useAppStore.getState().tuningParams : null,
    });
    deps.resetForNewTrack(context);
    useAppStore.setState({ lastTrackId: listenId });
    useAppStore.setState({ lastJobId: response.id });
    useAppStore.setState({
      lastSourceId:
        typeof response.source_id === "string" ? response.source_id : null,
    });
    useAppStore.setState({ lastSourceProvider: sourceProvider });
    useAppStore.setState({ pendingAutoFavoriteId: listenId });
    onAccepted?.();
    deps.updateTrackUrl(listenId, true, useAppStore.getState().tuningParams, useAppStore.getState().playMode);
    deps.setActiveTabWithRefresh("play");
    deps.setLoadingProgress(context, null, "Fetching audio");
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
            : "This track exceeds the server max track length."),
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
        fallback: "Upload failed.",
      }),
      { icon: "error", tone: "error" },
    );
  }
}
