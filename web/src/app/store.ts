import { create, type StateCreator } from "zustand";
import type { ToastQueueItem } from "@forever-jukebox/shared/ui/toastQueue";
import i18n from "./i18n";
import type { SpotifySearchItem, YoutubeSearchItem } from "./api";
import type { AppState, SleepTimerState, TabId } from "./context";
import type { ThemeName } from "./themeConfig";
import type { MaterialSymbolIconName } from "./material-icons";
import { DEFAULT_VISUALIZATION_INDEX } from "./constants";
import { emptyPlaylist } from "./playlist";
import { buildSearchParams, pathForTab, pathForTrack } from "./tabs";
import { getTuningParamsStringFromUrl } from "./tuning";

export type FooterCredit = {
  hostedByName: string | null;
  hostedByUrl: string | null;
};

export type ToastState = {
  message: string;
  icon?: MaterialSymbolIconName;
  tone: "default" | "error";
};

export type ToastItem = ToastQueueItem<ToastState>;

export type BranchStatsState = {
  title: LocalizedText;
  startText: string;
  endText: string;
  deltaText: string;
  startBeatText: string;
  endBeatText: string;
  beatDeltaText: string;
  direction: LocalizedText;
  similarityText: string;
  deleteDisabled: boolean;
};

export type TrackInfoState = {
  durationText: string;
  totalBeats: number;
  branchCount: number;
  deletedCount: number;
};

export type NavigationRequest = {
  id: number;
  to: string;
  replace?: boolean;
};

// Persistent store text is kept as a thunk so it re-translates when the
// language changes; components evaluate it on render.
export type LocalizedText = () => string;

export type SearchResultsState =
  | { kind: "message"; text: LocalizedText }
  | { kind: "spotify"; items: SpotifySearchItem[] }
  | {
      kind: "youtube";
      items: Array<{ item: YoutubeSearchItem; name: string; artist: string }>;
    };

export type TopSongsListTabId = "top" | "trending" | "recent";

export type TopSongsItem = {
  id?: string;
  title?: string;
  artist?: string;
  source_id?: string;
  source_provider?: string;
};

export type TopSongsListState =
  | { kind: "message"; text: LocalizedText }
  | { kind: "loaded"; items: TopSongsItem[] };

export const DEFAULT_SEARCH_HINT: LocalizedText = () =>
  i18n.t("search.hintStep1");
export const DEFAULT_SEARCH_RESULTS: SearchResultsState = {
  kind: "message",
  text: () => i18n.t("search.resultsEmpty"),
};

function createDefaultTopSongsLists(): Record<
  TopSongsListTabId,
  TopSongsListState
> {
  return {
    top: { kind: "message", text: () => i18n.t("topTracks.loadingTop") },
    trending: {
      kind: "message",
      text: () => i18n.t("topTracks.loadingTrending"),
    },
    recent: { kind: "message", text: () => i18n.t("topTracks.loadingRecent") },
  };
}

// Shell/panel UI state that has no AppState counterpart.
type ShellSlice = {
  theme: ThemeName;
  navigationRequest: NavigationRequest | null;
  isPlayTabPulsing: boolean;
  vizStatsPulseId: number;
  footerCredit: FooterCredit | null;
  toasts: ToastItem[];
  searchQuery: string;
  searchHint: LocalizedText;
  searchResults: SearchResultsState;
  topSongsLists: Record<TopSongsListTabId, TopSongsListState>;
  topSongsLoadedTabs: TopSongsListTabId[];
  topSongsInFlightTabs: TopSongsListTabId[];
  // Listen-panel modal/menu state. Open flags live here so the imperative
  // flows (openExtras hotkey, playlist buttons, resetForNewTrack) can drive
  // the React modals.
  tuningModalOpen: boolean;
  tuningModalTab: "tuning" | "extras";
  infoModalOpen: boolean;
  settingsModalOpen: boolean;
  feedbackModalOpen: boolean;
  playlistModalOpen: boolean;
  deleteConfirmOpen: boolean;
  trackInfo: TrackInfoState;
  favoriteToggleBusy: boolean;
  volumePct: number;
  isFullscreen: boolean;
  analysisStatusText: LocalizedText;
  analysisSpinning: boolean;
  analysisProgressText: string;
  // Job id offered for a one-click retry when a load failed with a
  // transient source fetch error; null hides the retry link.
  analysisRetryJobId: string | null;
  // Job id of a user-initiated retry currently loading. If this job fails
  // again the retry link is consumed rather than re-offered, so the button
  // only appears once per fresh load (a new search/reload re-enables it).
  retryInFlightJobId: string | null;
  listenTimeText: string;
  beatsPlayedText: string;
  playlistLoadBusy: boolean;
  branchStats: BranchStatsState | null;
};

type Actions = {
  setActiveTab: (tab: TabId) => void;
  setTheme: (theme: ThemeName) => void;
  setPlayTabPulsing: (pulsing: boolean) => void;
  setFooterCredit: (credit: FooterCredit | null) => void;
  // Navigation requests are consumed by the React router boundary in
  // <NavigationDriver>; non-React flows enqueue requests here instead of
  // reaching into react-router directly.
  navigateToTabWithState: (
    tabId: TabId,
    options?: {
      replace?: boolean;
      trackId?: string | null;
      tuningParams?: string | null;
    },
  ) => void;
  navigateToTrackWithState: (
    trackId: string,
    options?: {
      replace?: boolean;
      tuningParams?: string | null;
      playMode?: AppState["playMode"];
    },
  ) => void;
  selectTab: (tabId: TabId) => void;
  goHome: () => void;
  setTopSongsListState: (
    tabId: TopSongsListTabId,
    listState: TopSongsListState,
  ) => void;
  setTopSongsTabLoaded: (tabId: TopSongsListTabId, loaded: boolean) => void;
  setTopSongsTabInFlight: (
    tabId: TopSongsListTabId,
    inFlight: boolean,
  ) => void;
  resetTopSongsCache: () => void;
};

export type AppStoreState = AppState & ShellSlice & Actions;

type Slice<T> = StateCreator<AppStoreState, [], [], T>;

// Tabs whose own subtab selection resets to its default when navigated to,
// kept as a table so adding a tab's reset is a data edit, not another branch.
const SUBTAB_RESETS: Partial<Record<TabId, Partial<AppStoreState>>> = {
  top: { topSongsTab: "top" },
  search: { searchTab: "search" },
};

// The store is flat (zustand slices pattern); slices group state by domain
// (ui / playback / track / tuning / library / config).

const createUiSlice: Slice<
  Pick<
    AppStoreState,
    | "activeTabId"
    | "topSongsTab"
    | "searchTab"
    | "activeVizIndex"
    | "selectedEdge"
    | "theme"
    | "navigationRequest"
    | "isPlayTabPulsing"
    | "vizStatsPulseId"
    | "footerCredit"
    | "toasts"
    | "searchQuery"
    | "searchHint"
    | "searchResults"
    | "topSongsLists"
    | "topSongsLoadedTabs"
    | "topSongsInFlightTabs"
    | "tuningModalOpen"
    | "tuningModalTab"
    | "infoModalOpen"
    | "settingsModalOpen"
    | "feedbackModalOpen"
    | "playlistModalOpen"
    | "deleteConfirmOpen"
    | "trackInfo"
    | "favoriteToggleBusy"
    | "volumePct"
    | "isFullscreen"
    | "analysisStatusText"
    | "analysisSpinning"
    | "analysisProgressText"
    | "analysisRetryJobId"
    | "retryInFlightJobId"
    | "listenTimeText"
    | "beatsPlayedText"
    | "playlistLoadBusy"
    | "branchStats"
  > &
    Actions
> = (set, get) => {
  const queueNavigation = (to: string, replace?: boolean) => {
    const id = (get().navigationRequest?.id ?? 0) + 1;
    set({ navigationRequest: { id, to, replace } });
  };

  const updateTabList = (
    current: TopSongsListTabId[],
    tabId: TopSongsListTabId,
    included: boolean,
  ) => {
    if (included) {
      return current.includes(tabId) ? current : [...current, tabId];
    }
    return current.filter((currentTabId) => currentTabId !== tabId);
  };

  return {
    activeTabId: "top",
    topSongsTab: "top",
    searchTab: "search",
    activeVizIndex: DEFAULT_VISUALIZATION_INDEX,
    selectedEdge: null,
    theme: "dark",
    navigationRequest: null,
    isPlayTabPulsing: false,
    vizStatsPulseId: 0,
    footerCredit: null,
    toasts: [],
    searchQuery: "",
    searchHint: DEFAULT_SEARCH_HINT,
    searchResults: DEFAULT_SEARCH_RESULTS,
    topSongsLists: createDefaultTopSongsLists(),
    topSongsLoadedTabs: [],
    topSongsInFlightTabs: [],
    tuningModalOpen: false,
    tuningModalTab: "tuning",
    infoModalOpen: false,
    settingsModalOpen: false,
    feedbackModalOpen: false,
    playlistModalOpen: false,
    deleteConfirmOpen: false,
    trackInfo: {
      durationText: "00:00:00",
      totalBeats: 0,
      branchCount: 0,
      deletedCount: 0,
    },
    favoriteToggleBusy: false,
    volumePct: 100,
    isFullscreen: false,
    analysisStatusText: () => i18n.t("status.noTrack"),
    analysisSpinning: false,
    analysisProgressText: "",
    analysisRetryJobId: null,
    retryInFlightJobId: null,
    listenTimeText: "00:00:00",
    beatsPlayedText: "0",
    playlistLoadBusy: false,
    branchStats: null,
    setActiveTab: (activeTabId) => set({ activeTabId }),
    setTheme: (theme) => set({ theme }),
    setPlayTabPulsing: (isPlayTabPulsing) => set({ isPlayTabPulsing }),
    setFooterCredit: (footerCredit) => set({ footerCredit }),
    navigateToTabWithState: (tabId, options) => {
      get().setActiveTab(tabId);
      const state = get();
      const trackId =
        options && "trackId" in options ? options.trackId : getCurrentTrackId();
      const tuningParams =
        options && "tuningParams" in options
          ? options.tuningParams
          : (state.tuningParams ?? getTuningParamsStringFromUrl());
      const path = pathForTab(tabId, trackId);
      const search =
        tabId === "play" ? buildSearchParams(tuningParams, state.playMode) : "";
      queueNavigation(`${path}${search}`, options?.replace);
    },
    navigateToTrackWithState: (trackId, options) => {
      const state = get();
      queueNavigation(
        pathForTrack(
          trackId,
          options && "tuningParams" in options
            ? options.tuningParams
            : state.tuningParams,
          options?.playMode ?? state.playMode,
        ),
        options?.replace,
      );
    },
    selectTab: (tabId) => {
      const reset = SUBTAB_RESETS[tabId];
      if (reset) {
        set(reset);
      }
      get().navigateToTabWithState(tabId);
    },
    goHome: () => get().navigateToTabWithState("top"),
    setTopSongsListState: (tabId, listState) =>
      set((state) => ({
        topSongsLists: {
          ...state.topSongsLists,
          [tabId]: listState,
        },
      })),
    setTopSongsTabLoaded: (tabId, loaded) =>
      set((state) => ({
        topSongsLoadedTabs: updateTabList(
          state.topSongsLoadedTabs,
          tabId,
          loaded,
        ),
      })),
    setTopSongsTabInFlight: (tabId, inFlight) =>
      set((state) => ({
        topSongsInFlightTabs: updateTabList(
          state.topSongsInFlightTabs,
          tabId,
          inFlight,
        ),
      })),
    resetTopSongsCache: () =>
      set({
        topSongsLists: createDefaultTopSongsLists(),
        topSongsLoadedTabs: [],
        topSongsInFlightTabs: [],
      }),
  };
};

const defaultSleepTimer: SleepTimerState = {
  configuredDurationMs: null,
  endTimeMs: null,
  remainingMs: 0,
};

const createPlaybackSlice: Slice<
  Pick<
    AppStoreState,
    | "isRunning"
    | "isPaused"
    | "playMode"
    | "playTimerMs"
    | "lastPlayStamp"
    | "lastBeatIndex"
    | "autocanonizerMainSeconds"
    | "autocanonizerOtherSeconds"
    | "autocanonizerMainPan"
    | "autocanonizerOtherPan"
    | "vizData"
    | "shiftBranching"
    | "freezeBeat"
    | "bringItHomeMode"
    | "jukeboxAudioMode"
    | "audioIntensity"
    | "swingPreparing"
    | "swingRenderToken"
    | "sleepTimer"
  >
> = () => ({
  isRunning: false,
  isPaused: false,
  playMode: "jukebox",
  playTimerMs: 0,
  lastPlayStamp: null,
  lastBeatIndex: null,
  autocanonizerMainSeconds: 0,
  autocanonizerOtherSeconds: 0,
  autocanonizerMainPan: 0,
  autocanonizerOtherPan: 0,
  vizData: null,
  shiftBranching: false,
  freezeBeat: false,
  bringItHomeMode: false,
  jukeboxAudioMode: "off",
  audioIntensity: 100,
  swingPreparing: false,
  swingRenderToken: 0,
  sleepTimer: defaultSleepTimer,
});

const createTrackSlice: Slice<
  Pick<
    AppStoreState,
    | "audioLoaded"
    | "analysisLoaded"
    | "audioLoadInFlight"
    | "analysisPollInFlight"
    | "lastJobId"
    | "lastTrackId"
    | "lastSourceId"
    | "lastSourceProvider"
    | "trackTitle"
    | "trackArtist"
    | "trackDurationSec"
    | "lastPlayCountedJobId"
    | "deleteEligible"
    | "deleteEligibilityJobId"
  >
> = () => ({
  audioLoaded: false,
  analysisLoaded: false,
  audioLoadInFlight: false,
  analysisPollInFlight: false,
  lastJobId: null,
  lastTrackId: null,
  lastSourceId: null,
  lastSourceProvider: null,
  trackTitle: null,
  trackArtist: null,
  trackDurationSec: null,
  lastPlayCountedJobId: null,
  deleteEligible: false,
  deleteEligibilityJobId: null,
});

const createTuningSlice: Slice<
  Pick<
    AppStoreState,
    | "tuningParams"
    | "deletedEdgeIds"
    | "highlightAnchorBranch"
    | "branchStatsEnabled"
  >
> = () => ({
  tuningParams: null,
  deletedEdgeIds: [],
  highlightAnchorBranch: false,
  branchStatsEnabled: false,
});

const createLibrarySlice: Slice<
  Pick<
    AppStoreState,
    | "favorites"
    | "playlist"
    | "favoritesSyncCode"
    | "pendingAutoFavoriteId"
  >
> = () => ({
  favorites: [],
  playlist: emptyPlaylist(),
  favoritesSyncCode: null,
  pendingAutoFavoriteId: null,
});

const createConfigSlice: Slice<Pick<AppStoreState, "appConfig">> = () => ({
  appConfig: null,
});

export const useAppStore = create<AppStoreState>()((...args) => ({
  ...createUiSlice(...args),
  ...createPlaybackSlice(...args),
  ...createTrackSlice(...args),
  ...createTuningSlice(...args),
  ...createLibrarySlice(...args),
  ...createConfigSlice(...args),
}));

// The id of the track currently in context: the loaded track id, falling back
// to the analysis job id. Single source of truth for navigation/URL state and
// the imperative flows that need "what's playing now".
export function getCurrentTrackId(): string | null {
  const state = useAppStore.getState();
  return state.lastTrackId ?? state.lastJobId;
}
