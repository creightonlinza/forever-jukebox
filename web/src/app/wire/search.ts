import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import type { SearchDeps } from "../search";
import type { ToastOptions } from "../ui";

type SearchHandlersDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  searchDeps: SearchDeps;
  runSearch: (context: AppContext, deps: SearchDeps) => Promise<void>;
  showToast: (context: AppContext, message: string, options?: ToastOptions) => void;
  uploadAudio: (file: File) => Promise<{ id?: string } | null>;
  startYoutubeAnalysis: (payload: {
    youtube_id: string;
    is_user_supplied?: boolean;
  }) => Promise<{ id?: string } | null>;
  resetForNewTrack: (context: AppContext) => void;
  setActiveTabWithRefresh: (tabId: TabId) => void;
  setLoadingProgress: (
    context: AppContext,
    progress: number | null,
    message?: string | null,
  ) => void;
  updateTrackUrl: (
    youtubeId: string,
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
    startYoutubeAnalysis,
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
    return `Error: The maximum track length for this server is ${formatMinutes(minutes)} minutes.`;
  }

  function setButtonBusy(button: HTMLButtonElement, busy: boolean) {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function setButtonBusySpinnerOnly(button: HTMLButtonElement, busy: boolean) {
    setButtonBusy(button, busy);
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

  function extractYoutubeId(value: string) {
    const trimmed = value.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    if (host.endsWith("youtube.com")) {
      const idParam = url.searchParams.get("v");
      if (idParam) {
        return idParam;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts") {
        return parts[1] ?? null;
      }
    }
    return null;
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
    setButtonBusySpinnerOnly(elements.uploadFileButton, true);
    try {
      const response = await uploadAudio(file);
      if (!response || !response.id) {
        throw new Error("Upload failed");
      }
      resetForNewTrack(context);
      state.lastJobId = response.id;
      state.pendingAutoFavoriteId = response.id;
      state.lastYouTubeId = null;
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
        const fallbackLimit =
          typeof config.max_track_length === "number" &&
            Number.isFinite(config.max_track_length) &&
            config.max_track_length > 0
            ? config.max_track_length
            : null;
        showToast(
          context,
          (err as Error).message ||
            (fallbackLimit !== null
              ? maxTrackLengthMessage(fallbackLimit)
              : "Error: This track exceeds the server max track length."),
          {
            icon: "error",
            tone: "error",
          },
        );
        return;
      }
      showToast(context, `Upload failed: ${String(err)}`);
    } finally {
      setButtonBusySpinnerOnly(elements.uploadFileButton, false);
      uploadFileInFlight = false;
    }
  }

  async function handleUploadYoutubeClick() {
    if (uploadYoutubeInFlight) {
      return;
    }
    const config = state.appConfig;
    if (!config?.allow_user_youtube) {
      showToast(context, "YouTube uploads are disabled.");
      return;
    }
    const raw = elements.uploadYoutubeInput.value.trim();
    if (!raw) {
      showToast(context, "Enter a YouTube URL.");
      return;
    }
    const youtubeId = extractYoutubeId(raw);
    if (!youtubeId) {
      showToast(context, "Invalid YouTube URL.");
      return;
    }
    uploadYoutubeInFlight = true;
    setButtonBusySpinnerOnly(elements.uploadYoutubeButton, true);
    try {
      const response = await startYoutubeAnalysis({
        youtube_id: youtubeId,
        is_user_supplied: true,
      });
      if (!response || !response.id) {
        throw new Error("Upload failed");
      }
      resetForNewTrack(context);
      state.lastYouTubeId = youtubeId;
      state.lastJobId = response.id;
      state.pendingAutoFavoriteId = youtubeId;
      elements.uploadYoutubeInput.value = "";
      updateTrackUrl(youtubeId, true, state.tuningParams, state.playMode);
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Fetching audio");
      await pollAnalysisJob(response.id);
    } catch (err) {
      const trackTooLong =
        (err as Error & { code?: string }).code === "track_too_long";
      if (trackTooLong) {
        const fallbackLimit =
          typeof config.max_track_length === "number" &&
            Number.isFinite(config.max_track_length) &&
            config.max_track_length > 0
            ? config.max_track_length
            : null;
        showToast(
          context,
          (err as Error).message ||
            (fallbackLimit !== null
              ? maxTrackLengthMessage(fallbackLimit)
              : "Error: This track exceeds the server max track length."),
          {
            icon: "error",
            tone: "error",
          },
        );
        return;
      }
      showToast(context, `Upload failed: ${String(err)}`);
    } finally {
      setButtonBusySpinnerOnly(elements.uploadYoutubeButton, false);
      uploadYoutubeInFlight = false;
    }
  }

  return {
    handleSearchClick,
    handleSearchKeydown,
    handleUploadFileClick,
    handleUploadYoutubeClick,
  };
}
