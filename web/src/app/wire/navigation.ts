import type { TabId } from "../context";
import { useAppStore } from "../store";

export type NavigationHandlers = ReturnType<typeof createNavigationHandlers>;

// Thin shim over the store's navigation actions, kept so the imperative flows
// (wire/*) can keep receiving navigation as injected deps until they're folded.
// The single implementation now lives in the store (see store.ts navigation
// actions / web/TECH_DEBT.md item 1).
export function createNavigationHandlers() {

  function getCurrentTrackId() {
    return useAppStore.getState().lastTrackId ?? useAppStore.getState().lastJobId;
  }

  function navigateToTabWithState(
    tabId: TabId,
    options?: { replace?: boolean; trackId?: string | null },
  ) {
    useAppStore.getState().navigateToTabWithState(tabId, options);
  }

  function setActiveTabWithRefresh(tabId: TabId) {
    useAppStore.getState().setActiveTab(tabId);
  }

  return {
    getCurrentTrackId,
    navigateToTabWithState,
    setActiveTabWithRefresh,
  };
}
