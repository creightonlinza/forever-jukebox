import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import type { SearchDeps } from "../search";
import type { ToastOptions } from "../ui";
import {
  formatErrorForDisplay,
  inferSourceProviderFromUrl,
} from "../errorDisplay";

type SearchHandlersDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  searchDeps: SearchDeps;
  runSearch: (context: AppContext, deps: SearchDeps) => Promise<void>;
  showToast: (context: AppContext, message: string, options?: ToastOptions) => void;
  uploadAudio: (file: File) => Promise<{ id?: string } | null>;
  startUrlAnalysis: (payload: {
    url: string;
  }) => Promise<{
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
};

export type SearchHandlers = ReturnType<typeof createSearchHandlers>;

export function createSearchHandlers(deps: SearchHandlersDeps) {
  const {
    context,
    elements,
    state,
    searchDeps,
    runSearch,
    showToast,
    uploadAudio,
    startUrlAnalysis,
    resetForNewTrack,
    setActiveTabWithRefresh,
    setLoadingProgress,
    updateTrackUrl,
    pollAnalysisJob,
  } = deps;
  let searchInFlight = false;
  let uploadFileInFlight = false;
  let uploadYoutubeInFlight = false;

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

  function setButtonBusy(button: HTMLButtonElement, busy: boolean) {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }

  async function triggerSearch() {
    if (searchInFlight) {
      return;
    }
    searchInFlight = true;
    setButtonBusy(elements.searchButton, true);
    try {
      await runSearch(context, searchDeps);
    } finally {
      setButtonBusy(elements.searchButton, false);
      searchInFlight = false;
    }
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

  function handleSearchClick() {
    void triggerSearch();
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void triggerSearch();
    }
  }

  function normalizeSupportedSourceUrl(value: string) {
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

  async function handleUploadFileClick() {
    if (uploadFileInFlight) {
      return;
    }
    const config = state.appConfig;
    if (!config?.allow_user_upload) {
      showToast(context, "Uploads are disabled.");
      return;
    }
    const file = elements.uploadFileInput.files?.[0];
    if (!file) {
      showToast(context, "Choose a file to upload.");
      return;
    }
    if (config.max_upload_size && file.size > config.max_upload_size) {
      showToast(
        context,
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
        showToast(context, maxTrackLengthMessage(maxTrackLengthMinutes), {
          icon: "error",
          tone: "error",
        });
        return;
      }
    }
    uploadFileInFlight = true;
    setButtonBusy(elements.uploadFileButton, true);
    try {
      const response = await uploadAudio(file);
      if (!response || !response.id) {
        throw new Error("Upload failed");
      }
      resetForNewTrack(context);
      state.lastJobId = response.id;
      state.pendingAutoFavoriteId = response.id;
      state.lastTrackId = response.id;
      state.lastSourceProvider = "upload";
      state.audioLoaded = false;
      state.analysisLoaded = false;
      updateTrackUrl(response.id, true, state.tuningParams, state.playMode);
      elements.uploadFileInput.value = "";
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Queued");
      await pollAnalysisJob(response.id);
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
          context,
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
      showToast(context, `Upload failed: ${formatErrorForDisplay(err)}`, {
        icon: "error",
        tone: "error",
      });
    } finally {
      setButtonBusy(elements.uploadFileButton, false);
      uploadFileInFlight = false;
    }
  }

  async function handleUploadYoutubeClick() {
    if (uploadYoutubeInFlight) {
      return;
    }
    const config = state.appConfig;
    const allowUserUrl = Boolean(config?.allow_user_url);
    if (!allowUserUrl) {
      showToast(context, "URL uploads are disabled.");
      return;
    }
    const raw = elements.uploadYoutubeInput.value.trim();
    if (!raw) {
      showToast(context, "Enter a supported URL.");
      return;
    }
    const sourceUrl = normalizeSupportedSourceUrl(raw);
    if (!sourceUrl) {
      showToast(context, "Invalid or unsupported URL.");
      return;
    }
    const requestedSourceProvider = inferSourceProviderFromUrl(sourceUrl);
    uploadYoutubeInFlight = true;
    setButtonBusy(elements.uploadYoutubeButton, true);
    try {
      const response = await startUrlAnalysis({
        url: sourceUrl,
      });
      const sourceId = response?.source_id;
      const sourceProvider = response?.source_provider;
      if (response?.status === "failed") {
        showToast(
          context,
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
      if (sourceProvider === "youtube" && !sourceId) {
        throw new Error("Upload failed");
      }
      const listenId =
        sourceProvider === "youtube"
          ? (sourceId as string)
          : response.id;
      resetForNewTrack(context);
      state.lastTrackId = listenId;
      state.lastJobId = response.id;
      state.lastSourceProvider = sourceProvider;
      state.pendingAutoFavoriteId = listenId;
      elements.uploadYoutubeInput.value = "";
      updateTrackUrl(listenId, true, state.tuningParams, state.playMode);
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Fetching audio");
      await pollAnalysisJob(response.id);
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
          context,
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
        context,
        formatErrorForDisplay(err, {
          sourceProvider: requestedSourceProvider,
          fallback: "Upload failed.",
        }),
        { icon: "error", tone: "error" },
      );
    } finally {
      setButtonBusy(elements.uploadYoutubeButton, false);
      uploadYoutubeInFlight = false;
    }
  }

  function handleUploadYoutubeSubmit(event: SubmitEvent) {
    event.preventDefault();
    void handleUploadYoutubeClick();
  }

  return {
    handleSearchClick,
    handleSearchKeydown,
    handleUploadFileClick,
    handleUploadYoutubeClick,
    handleUploadYoutubeSubmit,
  };
}
