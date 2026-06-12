import type { AppContext, TabId } from "../context";
import {
  fetchAnalysis,
  fetchAudio,
  fetchJobBySource,
  recordPlay,
  type AnalysisComplete,
  type AnalysisResponse,
} from "../api";
import {
  isAnalysisComplete,
  isAnalysisFailed,
  isAnalysisInProgress,
} from "../analysisStatus";
import {
  deleteCachedTrack,
  readCachedTrack,
  updateCachedTrack,
} from "../cache";
import { ANALYSIS_POLL_INTERVAL_MS } from "../constants";
import { formatErrorForDisplay } from "../errorDisplay";
import { isLikelyJobId } from "../identity";
import {
  activatePlaylistTrack,
  emptyPlaylist,
  hasInactiveSavedPlaylist,
  isPlaylistActive,
  PLAYLIST_MAX_TRACKS,
  playlistTrackKey,
  replaceActivePlaylistTrack,
  savePlaylist,
  type PlaylistSourceType,
  type PlaylistTrack,
} from "../playlist";
import { useAppStore } from "../store";
import {
  applyTuningParamsFromUrl,
  clearTuningParamsFromUrl,
  getTuningParamsStringFromUrl,
  syncTuningParamsState,
  writeTuningParamsToUrl,
} from "../tuning";
import {
  closeInfo,
  closeTuning,
  syncVolumeUI,
  updateListenTimeDisplay,
  updateTrackInfo,
  updateVizVisibility,
} from "./status-ui";
import { maybePrepareSwingMode } from "./swing";
import { stopPlayback } from "./transport";
import {
  applyAnchorBranchFromUrl,
  applyDeletedEdgesFromUrl,
  syncDeletedEdgeState,
} from "./tuning-forms";

const GENERIC_LOAD_ERROR_MESSAGE =
  "Something went wrong. Please try again or report an issue on GitHub.";

export type PlaybackDeps = {
  setActiveTab: (tabId: TabId) => void;
  navigateToTab: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  updateTrackUrl: (trackId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  setLoadingProgress: (
    progress: number | null,
    message?: string | null,
  ) => void;
  onTrackChange?: (trackId: string | null) => void;
  onAnalysisLoaded?: (response: AnalysisComplete) => void;
  onPlaylistChange?: () => void;
};

export type TrackLoadOptions = {
  preserveUrlTuning?: boolean;
  playlistLoad?: boolean;
  preservePlaylist?: boolean;
  selectedTrack?: PlaylistTrack | null;
};

function maybeUpdateDeleteEligibility(
  context: AppContext,
  response: AnalysisResponse | null,
  jobIdOverride?: string | null,
) {
  if (!response) {
    return;
  }
  const { state } = context;
  const jobId = jobIdOverride ?? ("id" in response ? response.id : undefined);
  if (!jobId || state.deleteEligibilityJobId === jobId) {
    return;
  }
  let eligible = false;
  const createdAt = "created_at" in response ? response.created_at : undefined;
  if (typeof createdAt === "string") {
    const createdMs = Date.parse(createdAt);
    if (!Number.isNaN(createdMs)) {
      const ageMs = Date.now() - createdMs;
      eligible = ageMs <= 30 * 60 * 1000;
    }
  } else {
    state.deleteEligible = false;
    state.deleteEligibilityJobId = null;
    return;
  }
  state.deleteEligibilityJobId = jobId;
  state.deleteEligible = eligible;
}

export function resetForNewTrack(
  context: AppContext,
  options?: { clearTuning?: boolean },
) {
  const {
    autocanonizer,
    cowbellOverlay,
    engine,
    jukebox,
    player,
    state,
    defaultConfig,
  } = context;
  const shouldClearTuning = options?.clearTuning ?? false;
  const shouldPreserveTuning = options?.clearTuning === false;
  const preservedTuningParams = shouldPreserveTuning
    ? (state.tuningParams ?? getTuningParamsStringFromUrl())
    : null;
  const hadTrackLoaded =
    state.audioLoaded ||
    state.analysisLoaded ||
    state.lastJobId !== null ||
    state.lastTrackId !== null ||
    state.trackTitle !== null;
  if (hadTrackLoaded) {
    state.jukeboxAudioMode = "off";
    player.setJukeboxAudioMode("off");
  }
  cowbellOverlay.disable();
  cowbellOverlay.setSectionStartBeatIndices([]);
  state.swingRenderToken += 1;
  state.swingPreparing = false;
  cancelPoll(context);
  state.shiftBranching = false;
  engine.setForceBranch(false);
  state.bringItHomeMode = false;
  engine.setBringItHomeMode(false);
  state.selectedEdge = null;
  jukebox.setSelectedEdge(null);
  useAppStore.setState({ branchStats: null });
  engine.clearDeletedEdges();
  state.deletedEdgeIds = [];
  state.audioLoaded = false;
  state.analysisLoaded = false;
  state.audioLoadInFlight = false;
  state.lastJobId = null;
  state.lastTrackId = null;
  state.lastSourceId = null;
  state.lastSourceProvider = null;
  state.lastPlayCountedJobId = null;
  updateVizVisibility();
  state.playTimerMs = 0;
  state.lastPlayStamp = null;
  state.lastBeatIndex = null;
  updateListenTimeDisplay();
  useAppStore.setState({ beatsPlayedText: "0" });
  closeTuning();
  closeInfo();
  if (state.isRunning || state.isPaused) {
    stopPlayback(context);
  }
  autocanonizer.reset();
  state.autoComputedThreshold = null;
  if (shouldClearTuning) {
    state.tuningParams = null;
    clearTuningParamsFromUrl(true);
  }
  engine.updateConfig({ ...defaultConfig });
  syncVolumeUI(context);
  useAppStore.setState({
    analysisStatusText: "No track selected.",
    analysisSpinning: false,
    analysisProgressText: "",
  });
  state.trackDurationSec = null;
  state.trackTitle = null;
  state.trackArtist = null;
  state.deleteEligible = false;
  state.deleteEligibilityJobId = null;
  state.vizData = null;
  if (shouldPreserveTuning) {
    state.tuningParams = preservedTuningParams;
  } else {
    syncTuningParamsState(context);
  }
  if (hadTrackLoaded && !shouldClearTuning) {
    writeTuningParamsToUrl(state.tuningParams, true);
  }
  updateTrackInfo(context);
  const emptyVizData = {
    beats: [],
    edges: [],
    lastBranchPoint: -1,
    anchorEdgeId: null,
    userAnchorEdgeId: null,
  };
  jukebox.setData(emptyVizData);
  jukebox.reset();
}

export async function loadAudioFromJob(context: AppContext, jobId: string) {
  const { autocanonizer, player, state } = context;
  try {
    const buffer = await fetchAudio(jobId);
    await player.decode(buffer);
    autocanonizer.setAudio(player.getBuffer(), player.getContext());
    state.audioLoaded = true;
    state.audioLoadInFlight = false;
    updateVizVisibility();
    updateTrackInfo(context);
    maybePrepareSwingMode(context);
    const cacheId = state.lastTrackId ?? state.lastJobId;
    if (cacheId) {
      updateCachedTrack(cacheId, { audio: buffer, jobId }).catch((err) => {
        console.warn(`Cache save failed: ${String(err)}`);
      });
    }
    return true;
  } catch (err) {
    state.audioLoadInFlight = false;
    return false;
  }
}

export function applyAnalysisResult(
  context: AppContext,
  response: AnalysisComplete,
  onAnalysisLoaded?: (response: AnalysisComplete) => void,
): boolean {
  if (!response || response.status !== "complete" || !response.result) {
    return false;
  }
  maybeUpdateDeleteEligibility(context, response, response.id);
  const { autocanonizer, cowbellOverlay, engine, jukebox, state } = context;
  applyTuningParamsFromUrl(context);
  const useAutoThreshold = engine.getConfig().currentThreshold === 0;
  engine.loadAnalysis(response.result);
  cowbellOverlay.setSectionStartBeatIndices(engine.getSectionStartBeatIndices());
  applyDeletedEdgesFromUrl(context);
  applyAnchorBranchFromUrl(context);
  autocanonizer.setAnalysis(response.result, response.result.track?.duration);
  const graph = engine.getGraphState();
  state.autoComputedThreshold =
    useAutoThreshold && graph ? Math.round(graph.currentThreshold) : null;
  state.vizData = engine.getVisualizationData();
  const data = state.vizData;
  if (data) {
    jukebox.setData(data);
  }
  state.selectedEdge = null;
  jukebox.setSelectedEdge(null);
  useAppStore.setState({ branchStats: null });
  syncDeletedEdgeState(context);
  state.analysisLoaded = true;
  updateVizVisibility();
  maybePrepareSwingMode(context);
  const resultTrack = response.result.track ?? null;
  const track = resultTrack ?? response.track;
  const title = track?.title;
  const artist = track?.artist;
  state.trackTitle = typeof title === "string" ? title : null;
  state.trackArtist = typeof artist === "string" ? artist : null;
  state.trackDurationSec =
    typeof track?.duration === "number" && Number.isFinite(track.duration)
      ? track.duration
      : null;
  updateTrackInfo(context);
  syncActivePlaylistTrackFromLoaded(context);
  savePlaylist(state.playlist);
  onAnalysisLoaded?.(response);
  if (state.playMode === "jukebox") {
    writeTuningParamsToUrl(state.tuningParams, true);
  }
  const jobId = response.id || state.lastJobId;
  if (jobId) {
    recordPlayOnce(context, jobId).catch((err) => {
      console.warn(`Failed to record play: ${String(err)}`);
    });
  }
  return true;
}

async function recordPlayOnce(context: AppContext, jobId: string) {
  const { state } = context;
  if (state.lastPlayCountedJobId === jobId) {
    return;
  }
  state.lastPlayCountedJobId = jobId;
  try {
    await recordPlay(jobId);
  } catch (err) {
    state.lastPlayCountedJobId = null;
    throw err;
  }
}

export async function pollAnalysis(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string,
) {
  const { state } = context;
  const controller = new AbortController();
  state.pollController?.abort();
  state.pollController = controller;
  try {
    while (true) {
      if (controller.signal.aborted) {
        return;
      }
      let response: Awaited<ReturnType<typeof fetchAnalysis>>;
      try {
        response = await fetchAnalysis(jobId, controller.signal);
      } catch (err) {
        // A newer load cancelled this poll while the request was in flight;
        // exit silently instead of surfacing the abort as a load error.
        if (controller.signal.aborted) {
          return;
        }
        throw err;
      }
      if (!response) {
        deps.setAnalysisStatus(GENERIC_LOAD_ERROR_MESSAGE, false);
        return;
      }
      const previousTrackId = normalizeTrackIdentityFromResponse(context, deps, response);
      await migrateCachedAudioForResponse(context, response, previousTrackId);
      maybeUpdateDeleteEligibility(context, response, jobId);
      if (isAnalysisInProgress(response)) {
        const progress =
          typeof response.progress === "number" ? response.progress : null;
        deps.setLoadingProgress(progress, response.message);
        if (
          response.status !== "downloading" &&
          !state.audioLoaded &&
          !state.audioLoadInFlight
        ) {
          state.audioLoadInFlight = true;
          await loadAudioFromJob(context, jobId);
        }
      } else if (isAnalysisFailed(response)) {
        deps.setAnalysisStatus(
          formatErrorForDisplay(response.error, {
            sourceProvider: response.source_provider,
            errorCode: response.error_code,
            fallback: "Loading failed.",
          }),
          false,
        );
        return;
      } else if (isAnalysisComplete(response)) {
        if (!state.audioLoaded) {
          const audioLoaded = await loadAudioFromJob(context, jobId);
          if (!audioLoaded) {
            await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
            continue;
          }
        }
        deps.setLoadingProgress(100, "Calculating pathways");
        if (applyAnalysisResult(context, response, deps.onAnalysisLoaded)) {
          deps.setActiveTab("play");
          return;
        }
      }
      await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
    }
  } finally {
    if (state.pollController === controller) {
      state.pollController = null;
    }
  }
}

async function continueTrackLoadWithResponse(
  context: AppContext,
  deps: PlaybackDeps,
  response: AnalysisResponse | null,
): Promise<boolean> {
  if (!response || !response.id) {
    deps.setAnalysisStatus(GENERIC_LOAD_ERROR_MESSAGE, false);
    return false;
  }
  const previousTrackId = normalizeTrackIdentityFromResponse(context, deps, response);
  await migrateCachedAudioForResponse(context, response, previousTrackId);
  maybeUpdateDeleteEligibility(context, response, response.id);
  if (isAnalysisInProgress(response)) {
    await pollAnalysis(context, deps, response.id);
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
    return false;
  }
  if (isAnalysisComplete(response)) {
    if (!context.state.audioLoaded) {
      const audioLoaded = await loadAudioFromJob(context, response.id);
      if (!audioLoaded) {
        await pollAnalysis(context, deps, response.id);
        return true;
      }
    }
    if (!applyAnalysisResult(context, response, deps.onAnalysisLoaded)) {
      return false;
    }
    deps.setActiveTab("play");
    return true;
  }
  return false;
}

function normalizeTrackIdentityFromResponse(
  context: AppContext,
  deps: PlaybackDeps,
  response: AnalysisResponse,
) {
  if (!response.id) {
    return null;
  }
  const { state } = context;
  const previousTrackId = state.lastTrackId;
  state.lastJobId = response.id;
  state.lastTrackId = response.id;
  state.lastSourceId =
    typeof response.source_id === "string" ? response.source_id : null;
  if (typeof response.source_provider === "string") {
    state.lastSourceProvider = response.source_provider;
  }
  if (previousTrackId !== response.id) {
    deps.onTrackChange?.(response.id);
    deps.updateTrackUrl(response.id, true);
  }
  return previousTrackId;
}

async function migrateCachedAudioForResponse(
  context: AppContext,
  response: AnalysisResponse,
  previousTrackId: string | null,
) {
  if (!response.id || context.state.audioLoaded) {
    return;
  }
  if (await tryLoadCachedAudio(context, response.id)) {
    return;
  }
  const legacyKeys = new Set<string>();
  if (previousTrackId && previousTrackId !== response.id) {
    legacyKeys.add(previousTrackId);
  }
  if (
    (response.source_provider === "youtube" || !response.source_provider) &&
    typeof response.source_id === "string" &&
    response.source_id !== response.id
  ) {
    legacyKeys.add(response.source_id);
  }
  for (const legacyKey of legacyKeys) {
    try {
      const cached = await readCachedTrack(legacyKey);
      if (!cached?.audio) {
        continue;
      }
      await updateCachedTrack(response.id, {
        audio: cached.audio,
        jobId: cached.jobId ?? response.id,
      });
      await deleteCachedTrack(legacyKey);
      await tryLoadCachedAudio(context, response.id);
      return;
    } catch (err) {
      console.warn(`Cache migration failed: ${String(err)}`);
    }
  }
}

async function loadTrack(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
  options?: TrackLoadOptions,
): Promise<boolean> {
  const shouldClear = !options?.preserveUrlTuning;
  handlePlaylistForNormalTrackLoad(context, deps, source, options);
  resetForNewTrack(context, { clearTuning: shouldClear });
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  if (source.type === "source") {
    context.state.lastSourceProvider = source.provider;
    context.state.lastSourceId = source.id;
    context.state.lastTrackId = source.trackId;
    deps.onTrackChange?.(source.trackId);
  } else {
    context.state.lastJobId = source.id;
    context.state.lastTrackId = source.id;
    context.state.lastSourceId = null;
    context.state.lastSourceProvider = options?.selectedTrack?.sourceType ?? null;
    deps.onTrackChange?.(source.id);
  }
  const cacheKey =
    source.type === "source" && source.provider !== "youtube"
      ? `${source.provider}:${source.id}`
      : source.id;
  await tryLoadCachedAudio(context, cacheKey);
  try {
    const response =
      source.type === "source"
        ? await fetchJobBySource(source.provider, source.id)
        : await fetchAnalysis(source.id);
    return await continueTrackLoadWithResponse(context, deps, response);
  } catch (err) {
    deps.setAnalysisStatus(`Load failed: ${formatErrorForDisplay(err)}`, false);
    return false;
  }
}

export async function loadTrackById(
  context: AppContext,
  deps: PlaybackDeps,
  trackId: string,
  options?: TrackLoadOptions,
) {
  const parsed = parseTrackId(trackId);
  if (parsed.type === "job") {
    return await loadTrack(context, deps, { type: "job", id: parsed.jobId }, options);
  }
  return await loadTrack(
    context,
    deps,
    {
      type: "source",
      id: parsed.sourceId,
      provider: parsed.provider,
      trackId: parsed.trackId,
    },
    options,
  );
}

export async function loadTrackByJobId(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string,
  options?: TrackLoadOptions,
) {
  return await loadTrack(context, deps, { type: "job", id: jobId }, options);
}

function parseTrackId(trackId: string):
  | { type: "job"; jobId: string }
  | { type: "source"; provider: string; sourceId: string; trackId: string } {
  if (isLikelyJobId(trackId)) {
    return { type: "job", jobId: trackId };
  }
  const prefixed = /^([a-z]+):(.+)$/.exec(trackId);
  if (
    prefixed &&
    (prefixed[1] === "youtube" ||
      prefixed[1] === "soundcloud" ||
      prefixed[1] === "bandcamp")
  ) {
    return {
      type: "source",
      provider: prefixed[1],
      sourceId: prefixed[2],
      trackId,
    };
  }
  return {
    type: "source",
    provider: "youtube",
    sourceId: trackId,
    trackId,
  };
}

function handlePlaylistForNormalTrackLoad(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
  options?: TrackLoadOptions,
) {
  if (options?.playlistLoad) {
    return;
  }
  if (options?.preservePlaylist) {
    reconcilePreservedPlaylistTrack(context, deps, source);
    return;
  }
  const { state } = context;
  const playlist = state.playlist ?? emptyPlaylist();
  state.playlist = playlist;
  if (isPlaylistActive(playlist)) {
    const track =
      options?.selectedTrack ?? playlistTrackFromLoadSource(source, state.tuningParams);
    state.playlist = replaceActivePlaylistTrack(playlist, track);
    savePlaylist(state.playlist);
    deps.onPlaylistChange?.();
    return;
  }
  if (hasInactiveSavedPlaylist(playlist)) {
    state.playlist = emptyPlaylist();
    savePlaylist(state.playlist);
    deps.onPlaylistChange?.();
  }
}

function reconcilePreservedPlaylistTrack(
  context: AppContext,
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
) {
  const playlist = context.state.playlist ?? emptyPlaylist();
  context.state.playlist = playlist;
  if (playlist.tracks.length < 2) {
    return;
  }
  const sourceKey = playlistTrackKey(playlistTrackIdentityFromLoadSource(source));
  const matchingIndex = playlist.tracks.findIndex(
    (track) => playlistTrackKey(track) === sourceKey,
  );
  if (matchingIndex >= 0) {
    if (playlist.currentIndex === matchingIndex) {
      return;
    }
    context.state.playlist = activatePlaylistTrack(playlist, matchingIndex);
    deps.onPlaylistChange?.();
    return;
  }

  const nextTracks = playlist.tracks.slice(0, PLAYLIST_MAX_TRACKS);
  const nextTrack = playlistTrackFromLoadSource(source, context.state.tuningParams);
  let nextCurrentIndex = nextTracks.length;
  if (nextTracks.length >= PLAYLIST_MAX_TRACKS) {
    nextCurrentIndex = PLAYLIST_MAX_TRACKS - 1;
    nextTracks[nextCurrentIndex] = nextTrack;
  } else {
    nextTracks.push(nextTrack);
  }
  context.state.playlist = {
    tracks: nextTracks,
    currentIndex: nextCurrentIndex,
  };
  savePlaylist(context.state.playlist);
  deps.onPlaylistChange?.();
}

function playlistTrackFromLoadSource(
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
  tuningParams: string | null,
): PlaylistTrack {
  const identity = playlistTrackIdentityFromLoadSource(source);
  return {
    ...identity,
    title: "Untitled",
    artist: "",
    duration: null,
    tuningParams,
  };
}

function playlistTrackIdentityFromLoadSource(
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
): Pick<PlaylistTrack, "id" | "sourceType"> {
  if (source.type === "job") {
    return { id: source.id, sourceType: "upload" };
  }
  return {
    id: source.id,
    sourceType: playlistSourceTypeFromProvider(source.provider),
  };
}

function playlistSourceTypeFromProvider(provider: string): PlaylistSourceType {
  if (provider === "soundcloud" || provider === "bandcamp") {
    return provider;
  }
  if (provider === "upload") {
    return "upload";
  }
  return "youtube";
}

function syncActivePlaylistTrackFromLoaded(context: AppContext) {
  const { state } = context;
  const playlist = state.playlist ?? emptyPlaylist();
  state.playlist = playlist;
  if (!isPlaylistActive(playlist)) {
    return;
  }
  const track = playlist.tracks[playlist.currentIndex];
  if (!track) {
    return;
  }
  state.playlist = replaceActivePlaylistTrack(state.playlist, {
    ...track,
    id: state.lastTrackId ?? track.id,
    sourceType: playlistSourceTypeFromProvider(state.lastSourceProvider ?? track.sourceType),
    title: state.trackTitle || track.title || "Untitled",
    artist: state.trackArtist || track.artist || "",
    duration: state.trackDurationSec,
    tuningParams: state.playMode === "jukebox" ? state.tuningParams : null,
  });
}

export function cancelPoll(context: AppContext) {
  if (!context.state.pollController) {
    return;
  }
  context.state.pollController.abort();
  context.state.pollController = null;
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    if (!signal) {
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function tryLoadCachedAudio(
  context: AppContext,
  trackId: string,
) {
  const { autocanonizer, player, state } = context;
  try {
    const cached = await readCachedTrack(trackId);
    if (!cached?.audio) {
      return false;
    }
    state.lastJobId = cached.jobId ?? null;
    await player.decode(cached.audio);
    autocanonizer.setAudio(player.getBuffer(), player.getContext());
    state.audioLoaded = true;
    state.audioLoadInFlight = false;
    updateVizVisibility();
    updateTrackInfo(context);
    maybePrepareSwingMode(context);
    return true;
  } catch (err) {
    console.warn(`Cache lookup failed: ${String(err)}`);
    return false;
  }
}
