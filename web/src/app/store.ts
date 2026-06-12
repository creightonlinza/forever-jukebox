import { create, type StateCreator } from "zustand";
import type { AppState, SleepTimerState, TabId } from "./context";
import type { ThemeName } from "./themeConfig";
import { DEFAULT_VISUALIZATION_INDEX } from "./constants";
import { emptyPlaylist } from "./playlist";

export type FooterCredit = {
  hostedByName: string | null;
  hostedByUrl: string | null;
};

// Shell-only UI state that has no AppState counterpart.
type ShellSlice = {
  theme: ThemeName;
  isPlayTabPulsing: boolean;
  footerCredit: FooterCredit | null;
};

type Actions = {
  setActiveTab: (tab: TabId) => void;
  setTheme: (theme: ThemeName) => void;
  setPlayTabPulsing: (pulsing: boolean) => void;
  setFooterCredit: (credit: FooterCredit | null) => void;
};

export type AppStoreState = AppState & ShellSlice & Actions;

type Slice<T> = StateCreator<AppStoreState, [], [], T>;

// Slice layout follows the REACT_MIGRATION.md Phase 3 mapping. The store is
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
    | "topSongsRefreshTimer"
  >
> = () => ({
  favorites: [],
  playlist: emptyPlaylist(),
  favoritesSyncCode: null,
  pendingAutoFavoriteId: null,
  topSongsRefreshTimer: null,
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

// Legacy bridge: context.state is this proxy, so the untouched `state.x = y`
// mutations in playback.ts and wire/* flow through the store (and notify
// subscribers), and reads always see the latest snapshot. Audited: no legacy
// code mutates nested objects/arrays in place or enumerates state keys.
export const legacyAppState: AppState = new Proxy({} as AppState, {
  get(_target, prop) {
    return (useAppStore.getState() as unknown as Record<PropertyKey, unknown>)[
      prop
    ];
  },
  set(_target, prop, value) {
    useAppStore.setState({ [prop]: value } as Partial<AppStoreState>);
    return true;
  },
});
