import type { AppContext } from "./context";
import type { ThemeName } from "./themeConfig";

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

// Seam between the imperative bootstrap wiring and the React shell:
// components dispatch through it instead of importing actions directly.
// See web/TECH_DEBT.md for the plan to retire it.
export type AppBridge = {
  context: AppContext;
  // applyModeFromUrl + handleRouteChange — runs on initial load and browser
  // back/forward (POP) navigations.
  handleRoute: (pathname: string) => void;
  applyTheme: (theme: ThemeName) => void;
  // Window-level hotkey handlers (playback shortcuts, delete-confirm,
  // playlist-modal Escape) registered once by useGlobalHotkeys in AppRoot.
  hotkeys: {
    keydown: Array<(event: KeyboardEvent) => void>;
    keyup: Array<(event: KeyboardEvent) => void>;
  };
  searchPanel: SearchPanelBridge;
};
