import type { AppContext } from "./context";
import type { ThemeName } from "./themeConfig";

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
};
