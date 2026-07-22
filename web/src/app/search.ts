import type { AppContext, TabId } from "./context";
import { trackEvent } from "./analytics";
import { getLoadGeneration, isStaleLoad } from "./playback";
import {
  fetchJobByTrack,
  searchSpotify,
  searchYoutube,
  startYoutubeAnalysis,
  type AnalysisComplete,
} from "./api";
import type { ToastOptions } from "./ui";
import type { PlaylistTrack } from "./playlist";
import { tryLoadCachedAudio } from "./playback";
import {
  isAnalysisComplete,
  isAnalysisFailed,
  isAnalysisInProgress,
  isRetryableFetchFailure,
} from "./analysisStatus";
import { formatErrorForDisplay } from "./errorDisplay";
import {
  DEFAULT_SEARCH_HINT,
  DEFAULT_SEARCH_RESULTS,
  useAppStore,
  type LocalizedText,
  type SearchResultsState,
} from "./store";
import i18n from "./i18n";
import { translateJobProgress } from "./job-progress";

export type SearchDeps = {
  setActiveTab: (tabId: TabId) => void;
  navigateToTab: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null }
  ) => void;
  updateTrackUrl: (trackId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: LocalizedText, spinning: boolean) => void;
  showToast: (message: string, options?: ToastOptions) => void;
  setLoadingProgress: (
    progress: number | null,
    message?: LocalizedText | null,
  ) => void;
  pollAnalysis: (jobId: string) => Promise<void>;
  applyAnalysisResult: (response: AnalysisComplete) => boolean;
  loadAudioFromJob: (jobId: string) => Promise<boolean>;
  resetForNewTrack: (options?: { clearTuning?: boolean }) => void;
  updateVizVisibility: () => void;
  onTrackChange?: (trackId: string | null) => void;
  onNormalTrackSelected?: (track: PlaylistTrack) => void;
};

function formatMinutes(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(Math.trunc(rounded));
  }
  return String(rounded);
}

function getMaxTrackLengthMinutes(): number | null {
  const value = useAppStore.getState().appConfig?.max_track_length;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function isTrackLengthAllowed(deps: SearchDeps, duration: number): boolean {
  const maxTrackLengthMinutes = getMaxTrackLengthMinutes();
  if (
    maxTrackLengthMinutes !== null &&
    Number.isFinite(duration) &&
    duration > maxTrackLengthMinutes * 60
  ) {
    deps.showToast(
      i18n.t("search.maxTrackLength", {
        minutes: formatMinutes(maxTrackLengthMinutes),
      }),
      { icon: "error", tone: "error" },
    );
    return false;
  }
  return true;
}

// The search panel renders these store values.
function setSearchResults(results: SearchResultsState) {
  useAppStore.setState({ searchResults: results });
}

function setSearchMessage(text: LocalizedText) {
  setSearchResults({ kind: "message", text });
}

function setSearchHint(text: LocalizedText) {
  useAppStore.setState({ searchHint: text });
}

export async function startYoutubeAnalysisFlow(
  context: AppContext,
  deps: SearchDeps,
  youtubeId: string,
  title: string,
  artist: string
) {
  deps.resetForNewTrack({ clearTuning: true });
  const generation = getLoadGeneration();
  resetSearchUI(context);
  useAppStore.setState({ audioLoaded: false });
  useAppStore.setState({ analysisLoaded: false });
  deps.updateVizVisibility();
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, () => i18n.t("common.fetchingAudio"));
  useAppStore.setState({ lastTrackId: youtubeId });
  useAppStore.setState({ lastSourceId: youtubeId });
  useAppStore.setState({ lastSourceProvider: "youtube" });
  deps.onTrackChange?.(youtubeId);
  deps.updateTrackUrl(youtubeId);
  await tryLoadCachedAudio(context, youtubeId);
  if (isStaleLoad(generation)) {
    return;
  }
  const payload = { youtube_id: youtubeId, title, artist };
  const response = await startYoutubeAnalysis(payload);
  if (isStaleLoad(generation)) {
    return;
  }
  if (!response?.id) {
    throw new Error("Invalid job response");
  }
  const jobId = response.id;
  deps.onNormalTrackSelected?.({
    id: jobId,
    sourceType: "youtube",
    title,
    artist,
    duration: null,
    tuningParams: null,
  });
  useAppStore.setState({ lastTrackId: jobId });
  useAppStore.setState({ lastJobId: jobId });
  useAppStore.setState({
    lastSourceId:
      typeof response.source_id === "string" ? response.source_id : youtubeId,
  });
  useAppStore.setState({ lastSourceProvider: response.source_provider ?? "youtube" });
  deps.onTrackChange?.(jobId);
  deps.updateTrackUrl(jobId);
  await tryLoadCachedAudio(context, jobId);
  if (isStaleLoad(generation)) {
    return;
  }
  if (isAnalysisInProgress(response)) {
    const progress =
      typeof response.progress === "number" ? response.progress : null;
    deps.setLoadingProgress(
      progress,
      () => translateJobProgress(response.status, progress, response.message),
    );
  }
  await deps.pollAnalysis(jobId);
}

export async function showYoutubeMatches(
  _context: AppContext,
  deps: SearchDeps,
  name: string,
  artist: string,
  duration: number
) {
  const query = artist ? `${artist} - ${name}` : name;
  deps.navigateToTab("search", { replace: true });
  setSearchMessage(() => i18n.t("search.youtubeSearching"));
  setSearchHint(() => i18n.t("search.hintStep2"));
  try {
    const ytItems = await searchYoutube(query, duration);
    if (ytItems.length === 0) {
      setSearchMessage(() => i18n.t("search.youtubeNone"));
      setSearchHint(DEFAULT_SEARCH_HINT);
      return;
    }
    setSearchResults({
      kind: "youtube",
      items: ytItems.map((item) => ({ item, name, artist })),
    });
  } catch (err) {
    setSearchMessage(() =>
      i18n.t("search.youtubeSearchFailed", {
        error: formatErrorForDisplay(err),
      }),
    );
    setSearchHint(DEFAULT_SEARCH_HINT);
  }
}

export async function tryLoadExistingTrackByName(
  context: AppContext,
  deps: SearchDeps,
  title: string,
  artist: string
) {
  if (!artist) {
    return false;
  }
  setSearchMessage(() => i18n.t("search.checkingExisting"));
  setSearchHint(() => i18n.t("search.hintStep2"));
  const entryGeneration = getLoadGeneration();
  try {
    const response = await fetchJobByTrack(title, artist);
    // The user loaded another track while the lookup ran.
    if (isStaleLoad(entryGeneration)) {
      return true;
    }
    if (!response?.id) {
      return false;
    }
    const jobId = response.id;
    if (typeof response.source_provider === "string") {
      useAppStore.setState({ lastSourceProvider: response.source_provider });
    }
    useAppStore.setState({
      lastSourceId:
        typeof response.source_id === "string" ? response.source_id : null,
    });
    const sourceType =
      response.source_provider === "soundcloud" ||
      response.source_provider === "bandcamp" ||
      response.source_provider === "upload"
        ? response.source_provider
        : "youtube";
    deps.onNormalTrackSelected?.({
      id: jobId,
      sourceType,
      title,
      artist,
      duration: null,
      tuningParams: null,
    });
    deps.resetForNewTrack({ clearTuning: true });
    const generation = getLoadGeneration();
    resetSearchUI(context);
    useAppStore.setState({ audioLoaded: false });
    useAppStore.setState({ analysisLoaded: false });
    deps.updateVizVisibility();
    deps.setActiveTab("play");
    deps.setLoadingProgress(null, () => i18n.t("common.fetchingAudio"));
    useAppStore.setState({ lastTrackId: jobId });
    deps.onTrackChange?.(jobId);
    deps.updateTrackUrl(jobId);
    useAppStore.setState({ lastJobId: jobId });
    if (isAnalysisInProgress(response)) {
      await deps.pollAnalysis(jobId);
      return true;
    }
    if (isAnalysisFailed(response)) {
      deps.setAnalysisStatus(
        () =>
          formatErrorForDisplay(response.error, {
            sourceProvider: response.source_provider,
            errorCode: response.error_code,
            fallback: i18n.t("status.loadingFailed"),
          }),
        false,
      );
      if (isRetryableFetchFailure(response)) {
        // A fresh search always re-offers the retry link and starts a new
        // retry cycle, even for a job the user retried earlier.
        useAppStore.setState({
          analysisRetryJobId: jobId,
          retryInFlightJobId: null,
        });
      }
      return true;
    }
    if (isAnalysisComplete(response)) {
      if (!useAppStore.getState().audioLoaded) {
        const audioLoaded = await deps.loadAudioFromJob(jobId);
        if (isStaleLoad(generation)) {
          return true;
        }
        if (!audioLoaded) {
          await deps.pollAnalysis(jobId);
          return true;
        }
      }
      deps.applyAnalysisResult(response);
      return true;
    }
    await deps.pollAnalysis(jobId);
    return true;
  } catch (err) {
    setSearchMessage(() =>
      i18n.t("search.lookupFailed", { error: formatErrorForDisplay(err) }),
    );
    return false;
  }
}

export async function runSearch(_context: AppContext, _deps: SearchDeps) {
  const query = useAppStore.getState().searchQuery.trim().slice(0, 100);
  if (useAppStore.getState().searchQuery !== query) {
    useAppStore.setState({ searchQuery: query });
  }
  if (!query) {
    setSearchMessage(() => i18n.t("search.enterQuery"));
    return;
  }
  trackEvent("search", { search_term: query });
  setSearchMessage(() => i18n.t("search.spotifySearching"));
  setSearchHint(DEFAULT_SEARCH_HINT);
  try {
    const items = await searchSpotify(query);
    if (items.length === 0) {
      setSearchMessage(() => i18n.t("search.spotifyNone"));
      return;
    }
    setSearchResults({ kind: "spotify", items });
  } catch (err) {
    setSearchMessage(() =>
      i18n.t("search.searchFailed", { error: formatErrorForDisplay(err) }),
    );
  }
}

export function resetSearchUI(_context: AppContext) {
  useAppStore.setState({
    searchQuery: "",
    searchResults: DEFAULT_SEARCH_RESULTS,
    searchHint: DEFAULT_SEARCH_HINT,
  });
}

// Result selection — the React panel passes item data instead of DOM events.
export function selectYoutubeMatch(
  context: AppContext,
  deps: SearchDeps,
  selection: {
    youtubeId: string | null | undefined;
    name: string;
    artist: string;
    duration: number;
  },
) {
  const { youtubeId, name, artist, duration } = selection;
  if (!youtubeId) {
    deps.setAnalysisStatus(() => i18n.t("search.noYoutubeId"), false);
    return;
  }
  if (!isTrackLengthAllowed(deps, duration)) {
    return;
  }
  trackEvent("select_track", {
    source: "search",
    track_id: youtubeId,
    track_title: artist ? `${name} — ${artist}` : name,
  });
  startYoutubeAnalysisFlow(context, deps, youtubeId, name, artist).catch((err) => {
    deps.setAnalysisStatus(
      () =>
        i18n.t("search.youtubeAnalysisFailed", {
          error: formatErrorForDisplay(err, { sourceProvider: "youtube" }),
        }),
      false,
    );
  });
}

export function selectSpotifyMatch(
  context: AppContext,
  deps: SearchDeps,
  selection: { name: string; artist: string; duration: number },
) {
  const { name, artist, duration } = selection;
  if (!name) {
    return;
  }
  if (!isTrackLengthAllowed(deps, duration)) {
    return;
  }
  tryLoadExistingTrackByName(context, deps, name, artist).then((loaded) => {
    if (loaded) {
      trackEvent("select_track", {
        source: "search",
        track_title: artist ? `${name} — ${artist}` : name,
      });
      return;
    }
    if (!Number.isFinite(duration)) {
      deps.setAnalysisStatus(() => i18n.t("search.noDuration"), false);
      return;
    }
    showYoutubeMatches(context, deps, name, artist, duration).catch((err) => {
      setSearchMessage(() =>
        i18n.t("search.youtubeSearchFailed", {
          error: formatErrorForDisplay(err),
        }),
      );
      setSearchHint(DEFAULT_SEARCH_HINT);
    });
  }).catch((err) => {
    setSearchMessage(() =>
      i18n.t("search.lookupFailed", { error: formatErrorForDisplay(err) }),
    );
  });
}

// Module singleton: init registers the search flow's runtime (context +
// deps) so SearchPanel calls these without the bridge prop. (Phase 4)
let searchContext: AppContext | null = null;
let searchDeps: SearchDeps | null = null;

export function setSearchRuntime(context: AppContext, deps: SearchDeps): void {
  searchContext = context;
  searchDeps = deps;
}

export function submitSearch(): Promise<void> {
  if (!searchContext || !searchDeps) {
    return Promise.resolve();
  }
  return runSearch(searchContext, searchDeps);
}

export function selectSpotify(selection: {
  name: string;
  artist: string;
  duration: number;
}): void {
  if (!searchContext || !searchDeps) {
    return;
  }
  selectSpotifyMatch(searchContext, searchDeps, selection);
}

export function selectYoutube(selection: {
  youtubeId: string | null | undefined;
  name: string;
  artist: string;
  duration: number;
}): void {
  if (!searchContext || !searchDeps) {
    return;
  }
  selectYoutubeMatch(searchContext, searchDeps, selection);
}
