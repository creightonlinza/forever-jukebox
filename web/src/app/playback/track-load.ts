import type { AppContext, TabId } from "../context";
import {
  fetchAnalysis,
  fetchAudio,
  fetchJobBySource,
  recordPlay,
  retryJob,
  type AnalysisComplete,
  type AnalysisResponse,
} from "../api";
import {
  isAnalysisComplete,
  isAnalysisFailed,
  isAnalysisInProgress,
  isRetryableFetchFailure,
} from "../analysisStatus";
import {
  deleteCachedTrack,
  readCachedTrack,
  updateCachedTrack,
} from "../cache";
import { ANALYSIS_POLL_INTERVAL_MS } from "../constants";
import { formatErrorForDisplay } from "../errorDisplay";
import i18n from "../i18n";
import { isLikelyJobId } from "../identity";
import { translateJobProgress } from "../job-progress";
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
import { useAppStore, type LocalizedText } from "../store";
import {
  bumpLoadGeneration,
  getLoadGeneration,
  isStaleLoad,
} from "./load-generation";
import {
  applyTuningParamsFromUrl,
  clearTuningParamsFromUrl,
  getTuningParamsStringFromUrl,
  resetAudioModeToOff,
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

const GENERIC_LOAD_ERROR_MESSAGE = () => i18n.t("errors.generic");
let pollController: AbortController | null = null;

// Show the retry link for a transient fetch failure, unless this failure is
// the result of a retry the user already triggered for the same job — in
// which case the offer is consumed so the button only appears once.
function offerRetryLinkForFailure(
  response: AnalysisResponse | null,
  jobId: string,
): void {
  if (!isRetryableFetchFailure(response)) {
    return;
  }
  if (useAppStore.getState().retryInFlightJobId === jobId) {
    useAppStore.setState({ retryInFlightJobId: null });
    return;
  }
  useAppStore.setState({ analysisRetryJobId: jobId });
}

export type PlaybackDeps = {
  setActiveTab: (tabId: TabId) => void;
  navigateToTab: (
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) => void;
  updateTrackUrl: (trackId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: LocalizedText, spinning: boolean) => void;
  setLoadingProgress: (
    progress: number | null,
    message?: LocalizedText | null,
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
  response: AnalysisResponse | null,
  jobIdOverride?: string | null,
) {
  if (!response) {
    return;
  }
  const jobId = jobIdOverride ?? ("id" in response ? response.id : undefined);
  if (!jobId || useAppStore.getState().deleteEligibilityJobId === jobId) {
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
    useAppStore.setState({ deleteEligible: false });
    useAppStore.setState({ deleteEligibilityJobId: null });
    return;
  }
  useAppStore.setState({ deleteEligibilityJobId: jobId });
  useAppStore.setState({ deleteEligible: eligible });
}

export function resetForNewTrack(
  context: AppContext,
  options?: { clearTuning?: boolean },
) {
  bumpLoadGeneration();
  const {
    autocanonizer,
    cowbellOverlay,
    engine,
    jukebox,
    player,
    defaultConfig,
  } = context;
  const shouldClearTuning = options?.clearTuning ?? false;
  const shouldPreserveTuning = options?.clearTuning === false;
  const preservedTuningParams = shouldPreserveTuning
    ? (useAppStore.getState().tuningParams ?? getTuningParamsStringFromUrl())
    : null;
  const hadTrackLoaded =
    useAppStore.getState().audioLoaded ||
    useAppStore.getState().analysisLoaded ||
    useAppStore.getState().lastJobId !== null ||
    useAppStore.getState().lastTrackId !== null ||
    useAppStore.getState().trackTitle !== null;
  if (hadTrackLoaded) {
    resetAudioModeToOff(player);
  }
  cowbellOverlay.disable();
  cowbellOverlay.setSectionStartBeatIndices([]);
  useAppStore.setState({
    swingRenderToken: useAppStore.getState().swingRenderToken + (1),
  });
  useAppStore.setState({ swingPreparing: false });
  cancelPoll();
  useAppStore.setState({ shiftBranching: false });
  engine.setForceBranch(false);
  engine.setFreezeCurrentBeat(false);
  engine.setPlayVelocity(1);
  useAppStore.setState({ bringItHomeMode: false });
  engine.setBringItHomeMode(false);
  useAppStore.setState({ selectedEdge: null });
  jukebox?.setSelectedEdge(null);
  useAppStore.setState({ branchStats: null });
  engine.clearDeletedEdges();
  useAppStore.setState({ deletedEdgeIds: [] });
  useAppStore.setState({ audioLoaded: false });
  useAppStore.setState({ analysisLoaded: false });
  useAppStore.setState({ audioLoadInFlight: false });
  useAppStore.setState({ lastJobId: null });
  useAppStore.setState({ lastTrackId: null });
  useAppStore.setState({ lastSourceId: null });
  useAppStore.setState({ lastSourceProvider: null });
  useAppStore.setState({ lastPlayCountedJobId: null });
  updateVizVisibility();
  useAppStore.setState({ playTimerMs: 0 });
  useAppStore.setState({ lastPlayStamp: null });
  useAppStore.setState({
    lastBeatIndex: null,
    autocanonizerMainSeconds: 0,
    autocanonizerOtherSeconds: 0,
  });
  updateListenTimeDisplay();
  useAppStore.setState({ beatsPlayedText: "0" });
  closeTuning();
  closeInfo();
  if (useAppStore.getState().isRunning || useAppStore.getState().isPaused) {
    stopPlayback(context);
  }
  autocanonizer?.reset();
  if (shouldClearTuning) {
    useAppStore.setState({ tuningParams: null });
    clearTuningParamsFromUrl(true);
  }
  engine.updateConfig({ ...defaultConfig });
  syncVolumeUI(context);
  useAppStore.setState({
    analysisStatusText: () => i18n.t("status.noTrack"),
    analysisSpinning: false,
    analysisProgressText: "",
  });
  useAppStore.setState({ trackDurationSec: null });
  useAppStore.setState({ trackTitle: null });
  useAppStore.setState({ trackArtist: null });
  useAppStore.setState({ deleteEligible: false });
  useAppStore.setState({ deleteEligibilityJobId: null });
  useAppStore.setState({ vizData: null });
  if (shouldPreserveTuning) {
    useAppStore.setState({ tuningParams: preservedTuningParams });
  } else {
    syncTuningParamsState(context);
  }
  if (hadTrackLoaded && !shouldClearTuning) {
    writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
  }
  updateTrackInfo(context);
  const emptyVizData = {
    beats: [],
    edges: [],
    lastBranchPoint: -1,
    anchorEdgeId: null,
    userAnchorEdgeId: null,
  };
  jukebox?.setData(emptyVizData);
  jukebox?.reset();
}

export async function loadAudioFromJob(context: AppContext, jobId: string) {
  const { autocanonizer, player } = context;
  const generation = getLoadGeneration();
  try {
    const buffer = await fetchAudio(jobId);
    // A newer load started while this download was in flight: its audio
    // must not reach the player, the store, or the cache (where it would
    // persist under the newer track's id).
    if (isStaleLoad(generation)) {
      return false;
    }
    await player.decode(buffer);
    if (isStaleLoad(generation)) {
      return false;
    }
    autocanonizer?.setAudio(player.getBuffer(), player.getContext());
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ audioLoadInFlight: false });
    updateVizVisibility();
    updateTrackInfo(context);
    maybePrepareSwingMode(context);
    const cacheId = useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId;
    if (cacheId) {
      updateCachedTrack(cacheId, { audio: buffer, jobId }).catch((err) => {
        console.warn(`Cache save failed: ${String(err)}`);
      });
    }
    return true;
  } catch (err) {
    if (!isStaleLoad(generation)) {
      useAppStore.setState({ audioLoadInFlight: false });
    }
    return false;
  }
}

export function applyAnalysisResult(
  context: AppContext,
  response: AnalysisComplete,
  onAnalysisLoaded?: (response: AnalysisComplete) => void,
): boolean {
  if (response?.status !== "complete" || !response.result) {
    return false;
  }
  maybeUpdateDeleteEligibility(response, response.id);
  const { autocanonizer, cowbellOverlay, engine, jukebox } = context;
  if (!autocanonizer || !jukebox) {
    return false;
  }
  applyTuningParamsFromUrl(context);
  engine.loadAnalysis(response.result);
  cowbellOverlay.setSectionStartBeatIndices(engine.getSectionStartBeatIndices());
  applyDeletedEdgesFromUrl(context);
  applyAnchorBranchFromUrl(context);
  autocanonizer.setAnalysis(response.result, response.result.track?.duration);
  useAppStore.setState({ vizData: engine.getVisualizationData() });
  const data = useAppStore.getState().vizData;
  if (data) {
    jukebox.setData(data);
  }
  useAppStore.setState({ selectedEdge: null });
  jukebox.setSelectedEdge(null);
  useAppStore.setState({ branchStats: null });
  syncDeletedEdgeState(context);
  useAppStore.setState({ analysisLoaded: true });
  updateVizVisibility();
  maybePrepareSwingMode(context);
  const resultTrack = response.result.track ?? null;
  const track = resultTrack ?? response.track;
  const title = track?.title;
  const artist = track?.artist;
  useAppStore.setState({ trackTitle: typeof title === "string" ? title : null });
  useAppStore.setState({ trackArtist: typeof artist === "string" ? artist : null });
  useAppStore.setState({
    trackDurationSec:
      typeof track?.duration === "number" && Number.isFinite(track.duration)
        ? track.duration
        : null,
  });
  updateTrackInfo(context);
  syncActivePlaylistTrackFromLoaded();
  savePlaylist(useAppStore.getState().playlist);
  onAnalysisLoaded?.(response);
  if (useAppStore.getState().playMode === "jukebox") {
    writeTuningParamsToUrl(useAppStore.getState().tuningParams, true);
  }
  const jobId = response.id || useAppStore.getState().lastJobId;
  if (jobId) {
    recordPlayOnce(jobId).catch((err) => {
      console.warn(`Failed to record play: ${String(err)}`);
    });
  }
  return true;
}

async function recordPlayOnce(jobId: string) {
  if (useAppStore.getState().lastPlayCountedJobId === jobId) {
    return;
  }
  useAppStore.setState({ lastPlayCountedJobId: jobId });
  try {
    await recordPlay(jobId);
  } catch (err) {
    // Only clear our own guard; a newer track may own the field by now.
    if (useAppStore.getState().lastPlayCountedJobId === jobId) {
      useAppStore.setState({ lastPlayCountedJobId: null });
    }
    throw err;
  }
}

export async function pollAnalysis(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string,
) {
  const controller = new AbortController();
  const generation = getLoadGeneration();
  pollController?.abort();
  pollController = controller;
  useAppStore.setState({ analysisPollInFlight: true });
  try {
    while (true) {
      if (controller.signal.aborted || isStaleLoad(generation)) {
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
      const previousTrackId = normalizeTrackIdentityFromResponse(deps, response);
      await migrateCachedAudioForResponse(context, response, previousTrackId);
      if (isStaleLoad(generation)) {
        return;
      }
      maybeUpdateDeleteEligibility(response, jobId);
      if (isAnalysisInProgress(response)) {
        const progress =
          typeof response.progress === "number" ? response.progress : null;
        deps.setLoadingProgress(
          progress,
          () =>
            translateJobProgress(response.status, progress, response.message),
        );
        if (
          response.status !== "downloading" &&
          !useAppStore.getState().audioLoaded &&
          !useAppStore.getState().audioLoadInFlight
        ) {
          useAppStore.setState({ audioLoadInFlight: true });
          await loadAudioFromJob(context, jobId);
          if (isStaleLoad(generation)) {
            return;
          }
        }
      } else if (isAnalysisFailed(response)) {
        deps.setAnalysisStatus(
          () =>
            formatErrorForDisplay(response.error, {
              sourceProvider: response.source_provider,
              errorCode: response.error_code,
              fallback: i18n.t("status.loadingFailed"),
            }),
          false,
        );
        offerRetryLinkForFailure(response, jobId);
        return;
      } else if (isAnalysisComplete(response)) {
        if (!useAppStore.getState().audioLoaded) {
          const audioLoaded = await loadAudioFromJob(context, jobId);
          if (isStaleLoad(generation)) {
            return;
          }
          if (!audioLoaded) {
            await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
            continue;
          }
        }
        deps.setLoadingProgress(100, () =>
          i18n.t("status.calculatingPathways"),
        );
        if (applyAnalysisResult(context, response, deps.onAnalysisLoaded)) {
          deps.setActiveTab("play");
          return;
        }
      }
      await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
      if (controller.signal.aborted || isStaleLoad(generation)) {
        return;
      }
    }
  } finally {
    if (pollController === controller) {
      pollController = null;
      useAppStore.setState({ analysisPollInFlight: false });
    }
  }
}

async function continueTrackLoadWithResponse(
  context: AppContext,
  deps: PlaybackDeps,
  response: AnalysisResponse | null,
): Promise<boolean> {
  const generation = getLoadGeneration();
  if (!response?.id) {
    deps.setAnalysisStatus(GENERIC_LOAD_ERROR_MESSAGE, false);
    return false;
  }
  const previousTrackId = normalizeTrackIdentityFromResponse(deps, response);
  await migrateCachedAudioForResponse(context, response, previousTrackId);
  if (isStaleLoad(generation)) {
    return false;
  }
  maybeUpdateDeleteEligibility(response, response.id);
  if (isAnalysisInProgress(response)) {
    await pollAnalysis(context, deps, response.id);
    return !isStaleLoad(generation);
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
    offerRetryLinkForFailure(response, response.id);
    return false;
  }
  if (isAnalysisComplete(response)) {
    if (!useAppStore.getState().audioLoaded) {
      const audioLoaded = await loadAudioFromJob(context, response.id);
      if (isStaleLoad(generation)) {
        return false;
      }
      if (!audioLoaded) {
        await pollAnalysis(context, deps, response.id);
        return !isStaleLoad(generation);
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
  deps: PlaybackDeps,
  response: AnalysisResponse,
) {
  if (!response.id) {
    return null;
  }
  const previousTrackId = useAppStore.getState().lastTrackId;
  useAppStore.setState({ lastJobId: response.id });
  useAppStore.setState({ lastTrackId: response.id });
  useAppStore.setState({
    lastSourceId:
      typeof response.source_id === "string" ? response.source_id : null,
  });
  if (typeof response.source_provider === "string") {
    useAppStore.setState({ lastSourceProvider: response.source_provider });
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
  if (!response.id || useAppStore.getState().audioLoaded) {
    return;
  }
  if (await tryLoadCachedAudio(context, response.id)) {
    return;
  }
  const previousKeys = new Set<string>();
  if (previousTrackId && previousTrackId !== response.id) {
    previousKeys.add(previousTrackId);
  }
  if (
    (response.source_provider === "youtube" || !response.source_provider) &&
    typeof response.source_id === "string" &&
    response.source_id !== response.id
  ) {
    previousKeys.add(response.source_id);
  }
  for (const previousKey of previousKeys) {
    try {
      const cached = await readCachedTrack(previousKey);
      if (!cached?.audio) {
        continue;
      }
      await updateCachedTrack(response.id, {
        audio: cached.audio,
        jobId: cached.jobId ?? response.id,
      });
      await deleteCachedTrack(previousKey);
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
  handlePlaylistForNormalTrackLoad(deps, source, options);
  resetForNewTrack(context, { clearTuning: shouldClear });
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, () => i18n.t("common.fetchingAudio"));
  if (source.type === "source") {
    useAppStore.setState({ lastSourceProvider: source.provider });
    useAppStore.setState({ lastSourceId: source.id });
    useAppStore.setState({ lastTrackId: source.trackId });
    deps.onTrackChange?.(source.trackId);
  } else {
    useAppStore.setState({ lastJobId: source.id });
    useAppStore.setState({ lastTrackId: source.id });
    useAppStore.setState({ lastSourceId: null });
    useAppStore.setState({ lastSourceProvider: options?.selectedTrack?.sourceType ?? null });
    deps.onTrackChange?.(source.id);
  }
  const generation = getLoadGeneration();
  const cacheKey =
    source.type === "source" && source.provider !== "youtube"
      ? `${source.provider}:${source.id}`
      : source.id;
  await tryLoadCachedAudio(context, cacheKey);
  if (isStaleLoad(generation)) {
    return false;
  }
  try {
    let response =
      source.type === "source"
        ? await fetchJobBySource(source.provider, source.id)
        : await fetchAnalysis(source.id);
    // A newer load superseded this one while its initial request was in
    // flight; its response must not rewrite identity, URL, or status.
    if (isStaleLoad(generation)) {
      return false;
    }
    if (source.type === "job" && isAnalysisFailed(response)) {
      response = await retryJob(source.id);
      if (isStaleLoad(generation)) {
        return false;
      }
    }
    return await continueTrackLoadWithResponse(context, deps, response);
  } catch (err) {
    if (!isStaleLoad(generation)) {
      deps.setAnalysisStatus(
        () => i18n.t("status.loadFailed", { error: formatErrorForDisplay(err) }),
        false,
      );
    }
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
    reconcilePreservedPlaylistTrack(deps, source);
    return;
  }
  const playlist = useAppStore.getState().playlist ?? emptyPlaylist();
  useAppStore.setState({ playlist: playlist });
  if (isPlaylistActive(playlist)) {
    const track =
      options?.selectedTrack ?? playlistTrackFromLoadSource(source, useAppStore.getState().tuningParams);
    useAppStore.setState({ playlist: replaceActivePlaylistTrack(playlist, track) });
    savePlaylist(useAppStore.getState().playlist);
    deps.onPlaylistChange?.();
    return;
  }
  if (hasInactiveSavedPlaylist(playlist)) {
    useAppStore.setState({ playlist: emptyPlaylist() });
    savePlaylist(useAppStore.getState().playlist);
    deps.onPlaylistChange?.();
  }
}

function reconcilePreservedPlaylistTrack(
  deps: PlaybackDeps,
  source:
    | { type: "source"; id: string; provider: string; trackId: string }
    | { type: "job"; id: string },
) {
  const playlist = useAppStore.getState().playlist ?? emptyPlaylist();
  useAppStore.setState({ playlist: playlist });
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
    useAppStore.setState({ playlist: activatePlaylistTrack(playlist, matchingIndex) });
    deps.onPlaylistChange?.();
    return;
  }

  const nextTracks = playlist.tracks.slice(0, PLAYLIST_MAX_TRACKS);
  const nextTrack = playlistTrackFromLoadSource(source, useAppStore.getState().tuningParams);
  let nextCurrentIndex = nextTracks.length;
  if (nextTracks.length >= PLAYLIST_MAX_TRACKS) {
    nextCurrentIndex = PLAYLIST_MAX_TRACKS - 1;
    nextTracks[nextCurrentIndex] = nextTrack;
  } else {
    nextTracks.push(nextTrack);
  }
  useAppStore.setState({
    playlist: {
    tracks: nextTracks,
    currentIndex: nextCurrentIndex,
  }
  });
  savePlaylist(useAppStore.getState().playlist);
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
    title: i18n.t("common.untitled"),
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

function syncActivePlaylistTrackFromLoaded() {
  const playlist = useAppStore.getState().playlist ?? emptyPlaylist();
  useAppStore.setState({ playlist: playlist });
  if (!isPlaylistActive(playlist)) {
    return;
  }
  const track = playlist.tracks[playlist.currentIndex];
  if (!track) {
    return;
  }
  const {
    lastTrackId,
    lastSourceProvider,
    trackTitle,
    trackArtist,
    trackDurationSec,
    playMode,
    tuningParams,
  } = useAppStore.getState();
  useAppStore.setState({
    playlist: replaceActivePlaylistTrack(useAppStore.getState().playlist, {
      ...track,
      id: lastTrackId ?? track.id,
      sourceType: playlistSourceTypeFromProvider(
        lastSourceProvider ?? track.sourceType,
      ),
      title: trackTitle || track.title || i18n.t("common.untitled"),
      artist: trackArtist || track.artist || "",
      duration: trackDurationSec,
      tuningParams: playMode === "jukebox" ? tuningParams : null,
    }),
  });
}

export function cancelPoll() {
  if (!pollController) {
    return;
  }
  pollController.abort();
  pollController = null;
  useAppStore.setState({ analysisPollInFlight: false });
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
  const { autocanonizer, player } = context;
  const generation = getLoadGeneration();
  try {
    const cached = await readCachedTrack(trackId);
    if (!cached?.audio || isStaleLoad(generation)) {
      return false;
    }
    await player.decode(cached.audio);
    // Publish identity only after the decode survives supersession checks,
    // so a stale cached load can't overwrite a newer track's job id.
    if (isStaleLoad(generation)) {
      return false;
    }
    useAppStore.setState({ lastJobId: cached.jobId ?? null });
    autocanonizer?.setAudio(player.getBuffer(), player.getContext());
    useAppStore.setState({ audioLoaded: true });
    useAppStore.setState({ audioLoadInFlight: false });
    updateVizVisibility();
    updateTrackInfo(context);
    maybePrepareSwingMode(context);
    return true;
  } catch (err) {
    console.warn(`Cache lookup failed: ${String(err)}`);
    return false;
  }
}
