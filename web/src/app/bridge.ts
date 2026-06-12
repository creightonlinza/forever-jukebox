import type { AppContext, TabId } from "./context";
import type { FavoriteTrack } from "./favorites";
import type {
  ExtrasApplyResult,
  ExtrasFormValues,
  TuningFormValues,
} from "./playback";
import type { PlaylistTrack } from "./playlist";
import type { ThemeName } from "./themeConfig";
import type { PendingDelete } from "./wire/delete-job";

// Actions the React Top Tracks panel delegates to legacy flows (track
// loading, playlist, favorites sync state machine).
export type TopPanelBridge = {
  selectTrack: (trackId: string, selectedTrack: PlaylistTrack | null) => void;
  selectFavorite: (
    favoriteId: string,
    sourceType: FavoriteTrack["sourceType"],
  ) => void;
  addToPlaylist: (track: PlaylistTrack) => void;
  removeFavorite: (favoriteId: string) => void;
  refreshFavoritesFromSync: () => Promise<void>;
  enterSyncCode: (code: string) => Promise<"replaced" | "cancelled">;
  createSyncCode: () => Promise<string>;
};

// Actions the React Search/Upload panel delegates to the search/upload flows.
export type SearchPanelBridge = {
  runSearch: () => Promise<void>;
  selectSpotify: (selection: {
    name: string;
    artist: string;
    duration: number;
  }) => void;
  selectYoutube: (selection: {
    youtubeId: string | null | undefined;
    name: string;
    artist: string;
    duration: number;
  }) => void;
  uploadFile: (
    file: File | null | undefined,
    onAccepted?: () => void,
  ) => Promise<void>;
  uploadUrl: (raw: string, onAccepted?: () => void) => Promise<void>;
};

// Actions the React Listen-panel modals/menus delegate to playback.ts and
// the remaining wire controllers.
export type ListenPanelBridge = {
  copyShortUrl: () => void;
  toggleFavorite: () => void;
  getPendingDelete: () => PendingDelete | null;
  performDelete: (pending: PendingDelete) => Promise<void>;
  getTuningForm: () => TuningFormValues;
  applyTuning: (form: TuningFormValues) => TuningFormValues;
  resetTuning: () => void;
  getExtrasForm: () => ExtrasFormValues;
  applyExtras: (values: ExtrasFormValues) => ExtrasApplyResult;
  resetExtras: () => ExtrasApplyResult;
  setSleepTimer: (durationMs: number | null) => void;
  setVolume: (volumePct: number) => void;
  toggleFullscreen: () => void;
  togglePlayback: () => void;
  setPlayMode: (mode: "jukebox" | "autocanonizer") => void;
  setActiveVisualization: (index: number) => void;
  setCanonizerFinish: (checked: boolean) => void;
  playlistPrevious: () => void;
  playlistNext: () => void;
  deleteSelectedBranch: () => void;
  playlist: {
    selectIndex: (index: number) => void;
    removeIndex: (index: number) => void;
    clear: () => void;
  };
};

// Interim seam between bootstrap (legacy wiring) and the React shell.
// Shrinks as panels convert; replaced by the store + plain module imports
// once bootstrap is deleted in Phase 5.
export type AppBridge = {
  context: AppContext;
  // applyModeFromUrl + handleRouteChange — runs on initial load and browser
  // back/forward (POP) navigations.
  handleRoute: (pathname: string) => void;
  onTabClick: (tabId: TabId) => void;
  onHeroHomeClick: () => void;
  applyTheme: (theme: ThemeName) => void;
  // Window-level hotkey handlers (playback shortcuts, delete-confirm,
  // playlist-modal Escape) registered once by useGlobalHotkeys in AppRoot.
  hotkeys: {
    keydown: Array<(event: KeyboardEvent) => void>;
    keyup: Array<(event: KeyboardEvent) => void>;
  };
  topPanel: TopPanelBridge;
  searchPanel: SearchPanelBridge;
  listenPanel: ListenPanelBridge;
  // <VizContainer>'s ref handoff: constructs the viz controllers on these
  // nodes exactly once.
  attachViz: (nodes: {
    vizPanel: HTMLElement;
    vizLayer: HTMLDivElement;
    canonizerLayer: HTMLDivElement;
  }) => void;
};
