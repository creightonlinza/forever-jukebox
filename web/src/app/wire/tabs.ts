import type { AppState } from "../context";
import type { Elements } from "../elements";

type TabsDeps = {
  elements: Elements;
  state: AppState;
};

export type TabsHandlers = ReturnType<typeof createTabsHandlers>;

// Search/Upload subtab wiring — the last legacy subtab logic; converts with
// the Search panel (checkpoint 6).
export function createTabsHandlers(deps: TabsDeps) {
  const { elements, state } = deps;

  function setSearchTab(tabId: "search" | "upload") {
    state.searchTab = tabId;
    elements.searchSubtabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.searchSubtab === tabId);
    });
    elements.searchPanel.classList.toggle("hidden", tabId !== "search");
    elements.uploadPanel.classList.toggle("hidden", tabId !== "upload");
    elements.searchPanelTitle.textContent =
      tabId === "search" ? "Search" : "Upload";
  }

  function handleSearchSubtabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.searchSubtab as
      | "search"
      | "upload"
      | undefined;
    if (!tabId) {
      return;
    }
    setSearchTab(tabId);
  }

  return {
    setSearchTab,
    handleSearchSubtabClick,
  };
}
