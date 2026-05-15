import type { AppContext, TabId } from "./context";
import { formatTrackDuration } from "./format";
import {
  fetchJobByTrack,
  searchSpotify,
  searchYoutube,
  startYoutubeAnalysis,
  type AnalysisComplete,
  type SpotifySearchItem,
  type YoutubeSearchItem,
} from "./api";
import type { ToastOptions } from "./ui";
import { tryLoadCachedAudio } from "./playback";
import {
  isAnalysisComplete,
  isAnalysisFailed,
  isAnalysisInProgress,
} from "./analysisStatus";
import { formatErrorForDisplay } from "./errorDisplay";

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
};

function formatMinutes(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(Math.trunc(rounded));
  }
  return String(rounded);
}

function getMaxTrackLengthMinutes(context: AppContext): number | null {
  const value = context.state.appConfig?.max_track_length;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function isTrackLengthAllowed(
  context: AppContext,
  deps: SearchDeps,
  duration: number,
): boolean {
  const maxTrackLengthMinutes = getMaxTrackLengthMinutes(context);
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

function renderSearchList(
  container: HTMLElement,
  items: HTMLLIElement[],
) {
  const list = document.createElement("ol");
  list.className = "search-list";
  for (const item of items) {
    list.append(item);
  }
  container.replaceChildren(list);
}

function buildYoutubeMatchItem(
  context: AppContext,
  deps: SearchDeps,
  name: string,
  artist: string,
  item: YoutubeSearchItem,
) {
  const title = typeof item.title === "string" ? item.title : "Untitled";
  const ytDuration = typeof item.duration === "number" ? item.duration : null;
  const li = document.createElement("li");
  li.className = "search-item";
  li.dataset.youtubeId = item.id ? String(item.id) : "";
  li.dataset.trackName = name;
  li.dataset.trackArtist = artist;
  li.dataset.trackDuration = ytDuration !== null ? String(ytDuration) : "";
  const titleSpan = document.createElement("strong");
  titleSpan.textContent = title;
  const durationSpan = document.createElement("span");
  durationSpan.textContent = formatTrackDuration(ytDuration);
  const metaWrap = document.createElement("span");
  metaWrap.className = "search-meta";
  metaWrap.append(durationSpan);
  if (item.id) {
    const openLink = document.createElement("a");
    openLink.className = "search-open";
    openLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(String(item.id))}`;
    openLink.target = "_blank";
    openLink.rel = "noreferrer";
    openLink.title = "Open on YouTube";
    openLink.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    const openIcon = document.createElement("span");
    openIcon.className = "material-symbols-outlined search-open-icon";
    openIcon.setAttribute("aria-hidden", "true");
    openIcon.textContent = "open_in_new";
    openLink.append(openIcon);
    metaWrap.append(openLink);
  }
  li.append(titleSpan, metaWrap);
  li.addEventListener("click", (event) => {
    handleYoutubeMatchClick(context, deps, event);
  });
  return li;
}

function buildSpotifyMatchItem(
  context: AppContext,
  deps: SearchDeps,
  item: SpotifySearchItem,
) {
  const name = typeof item.name === "string" ? item.name : "Untitled";
  const artist = typeof item.artist === "string" ? item.artist : "";
  const title = artist ? `${name} — ${artist}` : name;
  const duration = typeof item.duration === "number" ? item.duration : null;
  const li = document.createElement("li");
  li.className = "search-item";
  li.dataset.trackName = name;
  li.dataset.trackArtist = artist;
  li.dataset.trackDuration = duration !== null ? String(duration) : "";
  const titleSpan = document.createElement("strong");
  titleSpan.textContent = title;
  const durationSpan = document.createElement("span");
  durationSpan.textContent = formatTrackDuration(item.duration);
  li.append(titleSpan, durationSpan);
  li.addEventListener("click", (event) => {
    handleSpotifyMatchClick(context, deps, event);
  });
  return li;
}

export async function startYoutubeAnalysisFlow(
  context: AppContext,
  deps: SearchDeps,
  youtubeId: string,
  title: string,
  artist: string
) {
  deps.resetForNewTrack({ clearTuning: true });
  resetSearchUI(context);
  context.state.audioLoaded = false;
  context.state.analysisLoaded = false;
  deps.updateVizVisibility();
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  context.state.lastTrackId = youtubeId;
  context.state.lastSourceProvider = "youtube";
  deps.onTrackChange?.(youtubeId);
  deps.updateTrackUrl(youtubeId);
  await tryLoadCachedAudio(context, youtubeId);
  const payload = { youtube_id: youtubeId, title, artist };
  const response = await startYoutubeAnalysis(payload);
  if (!response || !response.id) {
    throw new Error("Invalid job response");
  }
  if (isAnalysisInProgress(response)) {
    const progress =
      typeof response.progress === "number" ? response.progress : null;
    deps.setLoadingProgress(progress, response.message);
  }
  context.state.lastJobId = response.id;
  await deps.pollAnalysis(response.id);
}

export async function showYoutubeMatches(
  context: AppContext,
  deps: SearchDeps,
  name: string,
  artist: string,
  duration: number
) {
  const { elements } = context;
  const query = artist ? `${artist} - ${name}` : name;
  deps.navigateToTab("search", { replace: true });
  elements.searchResults.textContent = "Searching YouTube for matches...";
  elements.searchHint.textContent = "Step 2: Choose the closest YouTube match.";
  try {
    const ytItems = await searchYoutube(query, duration);
    if (ytItems.length === 0) {
      elements.searchResults.textContent = "No YouTube matches found.";
      elements.searchHint.textContent = "Step 1: Find a Spotify track.";
      return;
    }
    const rows = ytItems.map((item) =>
      buildYoutubeMatchItem(context, deps, name, artist, item),
    );
    renderSearchList(elements.searchResults, rows);
  } catch (err) {
    elements.searchResults.textContent =
      `YouTube search failed: ${formatErrorForDisplay(err)}`;
    elements.searchHint.textContent = "Step 1: Find a Spotify track.";
  }
}

export async function tryLoadExistingTrackByName(
  context: AppContext,
  deps: SearchDeps,
  title: string,
  artist: string
) {
  const { elements, state } = context;
  if (!artist) {
    return false;
  }
  elements.searchResults.textContent = "Checking existing analysis...";
  elements.searchHint.textContent = "Step 2: Choose the closest YouTube match.";
  try {
    const response = await fetchJobByTrack(title, artist);
    if (!response || !response.id) {
      return false;
    }
    const jobId = response.id;
    const trackId =
      response.source_id && response.source_provider && response.source_provider !== "youtube"
        ? `${response.source_provider}:${response.source_id}`
        : (response.source_id ?? jobId);
    if (typeof response.source_provider === "string") {
      state.lastSourceProvider = response.source_provider;
    }
    if (!trackId) {
      return false;
    }
    deps.resetForNewTrack({ clearTuning: true });
    resetSearchUI(context);
    state.audioLoaded = false;
    state.analysisLoaded = false;
    deps.updateVizVisibility();
    deps.setActiveTab("play");
    deps.setLoadingProgress(null, "Fetching audio");
    state.lastTrackId = trackId;
    deps.onTrackChange?.(trackId);
    deps.updateTrackUrl(trackId);
    state.lastJobId = jobId;
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
      if (!state.audioLoaded) {
        const audioLoaded = await deps.loadAudioFromJob(jobId);
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
    elements.searchResults.textContent =
      `Lookup failed: ${formatErrorForDisplay(err)}`;
    return false;
  }
}

export async function runSearch(context: AppContext, deps: SearchDeps) {
  const { elements } = context;
  const query = elements.searchInput.value.trim().slice(0, 100);
  if (elements.searchInput.value !== query) {
    elements.searchInput.value = query;
  }
  if (!query) {
    elements.searchResults.textContent = "Enter a search query.";
    return;
  }
  elements.searchButton.disabled = true;
  elements.searchResults.textContent = "Searching Spotify...";
  elements.searchHint.textContent = "Step 1: Find a Spotify track.";
  try {
    const items = await searchSpotify(query);
    if (items.length === 0) {
      elements.searchResults.textContent = "No Spotify results found.";
      return;
    }
    const rows = items.map((item) => buildSpotifyMatchItem(context, deps, item));
    renderSearchList(elements.searchResults, rows);
  } catch (err) {
    elements.searchResults.textContent =
      `Search failed: ${formatErrorForDisplay(err)}`;
  } finally {
    elements.searchButton.disabled = false;
  }
}

export function resetSearchUI(context: AppContext) {
  const { elements } = context;
  elements.searchInput.value = "";
  elements.searchResults.textContent = "Search results will appear here.";
  elements.searchHint.textContent = "Step 1: Find a Spotify track.";
}

function handleYoutubeMatchClick(
  context: AppContext,
  deps: SearchDeps,
  event: Event
) {
  const target = event.currentTarget as HTMLLIElement | null;
  const youtubeId = target?.dataset.youtubeId;
  const name = target?.dataset.trackName ?? "";
  const artist = target?.dataset.trackArtist ?? "";
  const duration = Number(target?.dataset.trackDuration ?? NaN);
  if (!youtubeId) {
    deps.setAnalysisStatus("No YouTube id available.", false);
    return;
  }
  if (!isTrackLengthAllowed(context, deps, duration)) {
    return;
  }
  startYoutubeAnalysisFlow(context, deps, youtubeId, name, artist).catch((err) => {
    deps.setAnalysisStatus(
      `YouTube analysis failed: ${formatErrorForDisplay(err, { sourceProvider: "youtube" })}`,
      false,
    );
  });
}

function handleSpotifyMatchClick(
  context: AppContext,
  deps: SearchDeps,
  event: Event
) {
  const target = event.currentTarget as HTMLLIElement | null;
  const name = target?.dataset.trackName ?? "";
  const artist = target?.dataset.trackArtist ?? "";
  const duration = Number(target?.dataset.trackDuration ?? NaN);
  if (!name) {
    return;
  }
  if (!isTrackLengthAllowed(context, deps, duration)) {
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
