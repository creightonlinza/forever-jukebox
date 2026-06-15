import type { AppContext, TabId } from "./context";
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
} from "./analysisStatus";
import { formatErrorForDisplay } from "./errorDisplay";
import {
  DEFAULT_SEARCH_HINT,
  DEFAULT_SEARCH_RESULTS,
  useAppStore,
  type SearchResultsState,
} from "./store";

export type SearchDeps = {
  setActiveTab: (tabId: TabId) => void;
  navigateToTab: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null }
  ) => void;
  updateTrackUrl: (trackId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  showToast: (message: string, options?: ToastOptions) => void;
  setLoadingProgress: (progress: number | null, message?: string | null) => void;
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
      `The maximum track length for this server is ${formatMinutes(maxTrackLengthMinutes)} minutes.`,
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

function setSearchMessage(text: string) {
  setSearchResults({ kind: "message", text });
}

function setSearchHint(text: string) {
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
  deps.setLoadingProgress(null, "Fetching audio");
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
  if (!response || !response.id) {
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
    deps.setLoadingProgress(progress, response.message);
  }
  await deps.pollAnalysis(jobId);
}

export async function showYoutubeMatches(
  context: AppContext,
  deps: SearchDeps,
  name: string,
  artist: string,
  duration: number
) {
  void context;
  const query = artist ? `${artist} - ${name}` : name;
  deps.navigateToTab("search", { replace: true });
  setSearchMessage("Searching YouTube for matches...");
  setSearchHint("Step 2: Choose the closest YouTube match.");
  try {
    const ytItems = await searchYoutube(query, duration);
    if (ytItems.length === 0) {
      setSearchMessage("No YouTube matches found.");
      setSearchHint(DEFAULT_SEARCH_HINT);
      return;
    }
    setSearchResults({
      kind: "youtube",
      items: ytItems.map((item) => ({ item, name, artist })),
    });
  } catch (err) {
    setSearchMessage(`YouTube search failed: ${formatErrorForDisplay(err)}`);
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
  setSearchMessage("Checking existing analysis...");
  setSearchHint("Step 2: Choose the closest YouTube match.");
  const entryGeneration = getLoadGeneration();
  try {
    const response = await fetchJobByTrack(title, artist);
    // The user loaded another track while the lookup ran.
    if (isStaleLoad(entryGeneration)) {
      return true;
    }
    if (!response || !response.id) {
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
      tuningParams: useAppStore.getState().playMode === "jukebox" ? useAppStore.getState().tuningParams : null,
    });
    deps.resetForNewTrack({ clearTuning: true });
    const generation = getLoadGeneration();
    resetSearchUI(context);
    useAppStore.setState({ audioLoaded: false });
    useAppStore.setState({ analysisLoaded: false });
    deps.updateVizVisibility();
    deps.setActiveTab("play");
    deps.setLoadingProgress(null, "Fetching audio");
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
        formatErrorForDisplay(response.error, {
          sourceProvider: response.source_provider,
          errorCode: response.error_code,
          fallback: "Loading failed.",
        }),
        false,
      );
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
    setSearchMessage(`Lookup failed: ${formatErrorForDisplay(err)}`);
    return false;
  }
}

export async function runSearch(context: AppContext, deps: SearchDeps) {
  void context;
  void deps;
  const query = useAppStore.getState().searchQuery.trim().slice(0, 100);
  if (useAppStore.getState().searchQuery !== query) {
    useAppStore.setState({ searchQuery: query });
  }
  if (!query) {
    setSearchMessage("Enter a search query.");
    return;
  }
  setSearchMessage("Searching Spotify...");
  setSearchHint(DEFAULT_SEARCH_HINT);
  try {
    const items = await searchSpotify(query);
    if (items.length === 0) {
      setSearchMessage("No Spotify results found.");
      return;
    }
    setSearchResults({ kind: "spotify", items });
  } catch (err) {
    setSearchMessage(`Search failed: ${formatErrorForDisplay(err)}`);
  }
}

export function resetSearchUI(context: AppContext) {
  void context;
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
    deps.setAnalysisStatus("No YouTube id available.", false);
    return;
  }
  if (!isTrackLengthAllowed(deps, duration)) {
    return;
  }
  startYoutubeAnalysisFlow(context, deps, youtubeId, name, artist).catch((err) => {
    deps.setAnalysisStatus(
      `YouTube analysis failed: ${formatErrorForDisplay(err, { sourceProvider: "youtube" })}`,
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
      return;
    }
    if (!Number.isFinite(duration)) {
      deps.setAnalysisStatus("No duration available for this track.", false);
      return;
    }
    void showYoutubeMatches(context, deps, name, artist, duration);
  });
}
