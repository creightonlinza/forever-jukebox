import type { AppContext, TabId } from "./context";
import type { FavoriteTrack } from "./favorites";
import type { PlaylistTrack } from "./playlist";
import type { ThemeName } from "./themeConfig";

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
  topPanel: TopPanelBridge;
  searchPanel: SearchPanelBridge;
};
