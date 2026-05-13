import type { AppContext, AppState, TabId } from "../context";
import { navigateToTab, setActiveTab } from "../tabs";
import { getTuningParamsStringFromUrl } from "../tuning";

type NavigationDeps = {
  context: AppContext;
  state: AppState;
};

export type NavigationHandlers = ReturnType<typeof createNavigationHandlers>;

export function createNavigationHandlers(deps: NavigationDeps) {
  const { context, state } = deps;

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

  function setActiveTabWithRefresh(tabId: TabId) {
    setActiveTab(context, tabId, () => {});
  }

  return {
    getCurrentTrackId,
    navigateToTabWithState,
    setActiveTabWithRefresh,
  };
}
