import type { AppContext, AppState, TabId } from "../context";
import { useAppStore } from "../store";
import { navigateToTab } from "../tabs";
import { getTuningParamsStringFromUrl } from "../tuning";

type NavigationDeps = {
  context: AppContext;
  state: AppState;
};

export type NavigationHandlers = ReturnType<typeof createNavigationHandlers>;

export function createNavigationHandlers(deps: NavigationDeps) {
  const { state } = deps;

  function getCurrentTrackId() {
    return state.lastTrackId ?? state.lastJobId;
  }

  function navigateToTabWithState(
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) {
    setActiveTabWithRefresh(tabId);
    const tuningParams = state.tuningParams ?? getTuningParamsStringFromUrl();
    navigateToTab(
      tabId,
      options,
      getCurrentTrackId(),
      tuningParams,
      state.playMode,
    );
  }

  // Tab visibility side effects now run in the React shell, keyed on the
  // store's activeTab (see AppRoot's useTabEffects).
  function setActiveTabWithRefresh(tabId: TabId) {
    useAppStore.getState().setActiveTab(tabId);
  }

  return {
    getCurrentTrackId,
    navigateToTabWithState,
    setActiveTabWithRefresh,
  };
}
