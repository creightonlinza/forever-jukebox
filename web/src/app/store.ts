import { create, type StateCreator } from "zustand";
import type { SpotifySearchItem, YoutubeSearchItem } from "./api";
import type { AppState, SleepTimerState, TabId } from "./context";
import type { ThemeName } from "./themeConfig";
import { DEFAULT_VISUALIZATION_INDEX } from "./constants";
import { emptyPlaylist } from "./playlist";

export type FooterCredit = {
  hostedByName: string | null;
  hostedByUrl: string | null;
};

export type ToastState = {
  message: string;
  icon?: string;
  tone: "default" | "error";
};

export type BranchStatsState = {
  title: string;
  startText: string;
  endText: string;
  deltaText: string;
  direction: string;
  similarityText: string;
  deleteDisabled: boolean;
};

export type TrackInfoState = {
  durationText: string;
  totalBeats: number;
  branchCount: number;
  deletedCount: number;
};

export type SearchResultsState =
  | { kind: "message"; text: string }
  | { kind: "spotify"; items: SpotifySearchItem[] }
  | {
      kind: "youtube";
      items: Array<{ item: YoutubeSearchItem; name: string; artist: string }>;
    };

export const DEFAULT_SEARCH_HINT = "Step 1: Find a Spotify track.";
export const DEFAULT_SEARCH_RESULTS: SearchResultsState = {
  kind: "message",
  text: "Search results will appear here.",
};

// Shell/panel UI state that has no AppState counterpart.
type ShellSlice = {
  theme: ThemeName;
  isPlayTabPulsing: boolean;
  footerCredit: FooterCredit | null;
  toast: ToastState | null;
  searchQuery: string;
  searchHint: string;
  searchResults: SearchResultsState;
  // Listen-panel modal/menu state (checkpoint 8a). Open flags live here so
  // legacy flows (openExtras hotkey, playlist buttons, resetForNewTrack)
  // can drive the React modals.
  tuningModalOpen: boolean;
  tuningModalTab: "tuning" | "extras";
  infoModalOpen: boolean;
  sleepTimerModalOpen: boolean;
  playlistModalOpen: boolean;
  deleteConfirmOpen: boolean;
  trackInfo: TrackInfoState;
  favoriteToggleBusy: boolean;
  volumePct: number;
  isFullscreen: boolean;
  analysisStatusText: string;
  analysisSpinning: boolean;
  analysisProgressText: string;
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
};

export type AppStoreState = AppState & ShellSlice & Actions;

type Slice<T> = StateCreator<AppStoreState, [], [], T>;

// Slice layout follows the migration plan's ui/playback/track/tuning/library/
// config mapping. The store is
// flat (zustand slices pattern) so legacy field names survive unchanged.
// Non-serializable handles (pollController, wakeLock, timer ids) are fine in
// zustand; no devtools middleware is attached, so nothing serializes them.

const createUiSlice: Slice<
  Pick<
    AppStoreState,
    | "activeTabId"
    | "topSongsTab"
    | "searchTab"
    | "activeVizIndex"
    | "toastTimer"
    | "selectedEdge"
    | "theme"
    | "isPlayTabPulsing"
    | "footerCredit"
    | "toast"
    | "searchQuery"
    | "searchHint"
    | "searchResults"
    | "tuningModalOpen"
    | "tuningModalTab"
    | "infoModalOpen"
    | "sleepTimerModalOpen"
    | "playlistModalOpen"
    | "deleteConfirmOpen"
    | "trackInfo"
    | "favoriteToggleBusy"
    | "volumePct"
    | "isFullscreen"
    | "analysisStatusText"
    | "analysisSpinning"
    | "analysisProgressText"
    | "listenTimeText"
    | "beatsPlayedText"
    | "playlistLoadBusy"
    | "branchStats"
  > &
    Actions
> = (set) => ({
  activeTabId: "top",
  topSongsTab: "top",
  searchTab: "search",
  activeVizIndex: DEFAULT_VISUALIZATION_INDEX,
  toastTimer: null,
  selectedEdge: null,
  theme: "dark",
  isPlayTabPulsing: false,
  footerCredit: null,
  toast: null,
  searchQuery: "",
  searchHint: DEFAULT_SEARCH_HINT,
  searchResults: DEFAULT_SEARCH_RESULTS,
  tuningModalOpen: false,
  tuningModalTab: "tuning",
  infoModalOpen: false,
  sleepTimerModalOpen: false,
  playlistModalOpen: false,
  deleteConfirmOpen: false,
  trackInfo: {
    durationText: "00:00:00",
    totalBeats: 0,
    branchCount: 0,
    deletedCount: 0,
  },
  favoriteToggleBusy: false,
  volumePct: 50,
  isFullscreen: false,
  analysisStatusText: "No track selected.",
  analysisSpinning: false,
  analysisProgressText: "",
  listenTimeText: "00:00:00",
  beatsPlayedText: "0",
  playlistLoadBusy: false,
  branchStats: null,
  setActiveTab: (activeTabId) => set({ activeTabId }),
  setTheme: (theme) => set({ theme }),
  setPlayTabPulsing: (isPlayTabPulsing) => set({ isPlayTabPulsing }),
  setFooterCredit: (footerCredit) => set({ footerCredit }),
});

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
    | "vizData"
    | "shiftBranching"
    | "bringItHomeMode"
    | "jukeboxAudioMode"
    | "swingPreparing"
    | "swingRenderToken"
    | "sleepTimer"
    | "sleepTimerTimeoutId"
    | "wakeLock"
    | "listenTimerId"
  >
> = () => ({
  isRunning: false,
  isPaused: false,
  playMode: "jukebox",
  playTimerMs: 0,
  lastPlayStamp: null,
  lastBeatIndex: null,
  vizData: null,
  shiftBranching: false,
  bringItHomeMode: false,
  jukeboxAudioMode: "off",
  swingPreparing: false,
  swingRenderToken: 0,
  sleepTimer: defaultSleepTimer,
  sleepTimerTimeoutId: null,
  wakeLock: null,
  listenTimerId: null,
});

const createTrackSlice: Slice<
  Pick<
    AppStoreState,
    | "audioLoaded"
    | "analysisLoaded"
    | "audioLoadInFlight"
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
    | "pollController"
  >
> = () => ({
  audioLoaded: false,
  analysisLoaded: false,
  audioLoadInFlight: false,
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
  pollController: null,
});

const createTuningSlice: Slice<
  Pick<
    AppStoreState,
    | "tuningParams"
    | "autoComputedThreshold"
    | "deletedEdgeIds"
    | "highlightAnchorBranch"
    | "branchStatsEnabled"
  >
> = () => ({
  tuningParams: null,
  autoComputedThreshold: null,
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
