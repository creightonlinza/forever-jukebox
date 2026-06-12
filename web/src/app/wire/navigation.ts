import type { TabId } from "../context";
import { useAppStore } from "../store";
import { navigateToTab } from "../tabs";
import { getTuningParamsStringFromUrl } from "../tuning";

export type NavigationHandlers = ReturnType<typeof createNavigationHandlers>;

export function createNavigationHandlers() {

  function getCurrentTrackId() {
    return useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId;
  }

  function navigateToTabWithState(
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) {
    setActiveTabWithRefresh(tabId);
    const tuningParams = useAppStore.getState().tuningParams ?? getTuningParamsStringFromUrl();
    navigateToTab(
      tabId,
      options,
      getCurrentTrackId(),
      tuningParams,
      useAppStore.getState().playMode,
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
