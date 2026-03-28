import type { AppContext } from "./context";
import { formatTrackDuration } from "./format";
import {
  fetchJobByTrack,
  searchSpotify,
  searchYoutube,
  startYoutubeAnalysis,
  type AnalysisComplete,
  type AnalysisFailed,
  type AnalysisInProgress,
  type AnalysisResponse,
} from "./api";
import type { ToastOptions } from "./ui";
import { tryLoadCachedAudio } from "./playback";

export type SearchDeps = {
  setActiveTab: (tabId: "top" | "search" | "play" | "faq") => void;
  navigateToTab: (
    tabId: "top" | "search" | "play" | "faq",
    options?: { replace?: boolean; youtubeId?: string | null }
  ) => void;
  updateTrackUrl: (youtubeId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  showToast: (message: string, options?: ToastOptions) => void;
  setLoadingProgress: (progress: number | null, message?: string | null) => void;
  pollAnalysis: (jobId: string) => Promise<void>;
  applyAnalysisResult: (response: AnalysisComplete) => boolean;
  loadAudioFromJob: (jobId: string) => Promise<boolean>;
  resetForNewTrack: (options?: { clearTuning?: boolean }) => void;
  updateVizVisibility: () => void;
  onTrackChange?: (youtubeId: string | null) => void;
};

function isAnalysisComplete(response: AnalysisResponse | null): response is AnalysisComplete {
  return response?.status === "complete";
}

function isAnalysisFailed(response: AnalysisResponse | null): response is AnalysisFailed {
  return response?.status === "failed";
}

function isAnalysisInProgress(
  response: AnalysisResponse | null
): response is AnalysisInProgress {
  return (
    response?.status === "downloading" ||
    response?.status === "queued" ||
    response?.status === "processing"
  );
}

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
  context.state.lastYouTubeId = youtubeId;
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
    elements.searchResults.innerHTML = "";
    const list = document.createElement("ol");
    list.className = "search-list";
    for (const item of ytItems) {
      const title = typeof item.title === "string" ? item.title : "Untitled";
      const ytDuration =
        typeof item.duration === "number" ? item.duration : null;
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
      function handleClick(event: Event) {
        handleYoutubeMatchClick(context, deps, event);
      }
      li.addEventListener("click", handleClick);
      list.append(li);
    }
    elements.searchResults.append(list);
  } catch (err) {
    elements.searchResults.textContent = `YouTube search failed: ${String(err)}`;
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
    const youtubeId = response.youtube_id ?? state.lastYouTubeId;
    if (!youtubeId) {
      return false;
    }
    deps.resetForNewTrack({ clearTuning: true });
    resetSearchUI(context);
    state.audioLoaded = false;
    state.analysisLoaded = false;
    deps.updateVizVisibility();
    deps.setActiveTab("play");
    deps.setLoadingProgress(null, "Fetching audio");
    state.lastYouTubeId = youtubeId;
    deps.onTrackChange?.(youtubeId);
    deps.updateTrackUrl(youtubeId);
    state.lastJobId = jobId;
    if (isAnalysisInProgress(response)) {
      await deps.pollAnalysis(jobId);
      return true;
    }
    if (isAnalysisFailed(response)) {
      return false;
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
    elements.searchResults.textContent = `Lookup failed: ${String(err)}`;
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
    elements.searchResults.innerHTML = "";
    const list = document.createElement("ol");
    list.className = "search-list";
    for (const item of items) {
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
      function handleClick(event: Event) {
        handleSpotifyMatchClick(context, deps, event);
      }
      li.addEventListener("click", handleClick);
      list.append(li);
    }
    elements.searchResults.append(list);
  } catch (err) {
    elements.searchResults.textContent = `Search failed: ${String(err)}`;
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
  const maxTrackLengthMinutes = getMaxTrackLengthMinutes(context);
  if (
    maxTrackLengthMinutes !== null &&
    Number.isFinite(duration) &&
    duration > maxTrackLengthMinutes * 60
  ) {
    deps.showToast(
      `Error: The maximum track length for this server is ${formatMinutes(maxTrackLengthMinutes)} minutes.`,
      { icon: "error", tone: "error" },
    );
    return;
  }
  startYoutubeAnalysisFlow(context, deps, youtubeId, name, artist).catch((err) => {
    deps.setAnalysisStatus(`YouTube analysis failed: ${String(err)}`, false);
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
  const maxTrackLengthMinutes = getMaxTrackLengthMinutes(context);
  if (
    maxTrackLengthMinutes !== null &&
    Number.isFinite(duration) &&
    duration > maxTrackLengthMinutes * 60
  ) {
    deps.showToast(
      `Error: The maximum track length for this server is ${formatMinutes(maxTrackLengthMinutes)} minutes.`,
      { icon: "error", tone: "error" },
    );
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
