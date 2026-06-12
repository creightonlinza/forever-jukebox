import type { AppContext, TabId } from "./context";
import type { ThemeName } from "./themeConfig";

// Interim seam between bootstrap (legacy wiring) and the React shell.
// Shrinks as panels convert; replaced by the store + plain module imports
// once bootstrap is deleted in Phase 5.
export type AppBridge = {
  context: AppContext;
  // applyModeFromUrl + handleRouteChange + FAQ subtab sync — runs on initial
  // load and browser back/forward (POP) navigations.
  handleRoute: (pathname: string) => void;
  onTabClick: (tabId: TabId) => void;
  onHeroHomeClick: () => void;
  applyTheme: (theme: ThemeName) => void;
};
