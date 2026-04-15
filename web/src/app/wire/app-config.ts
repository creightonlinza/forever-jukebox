import type { AppConfig } from "../api";
import type { AppState } from "../context";
import type { Elements } from "../elements";
import type { FavoritesHandlers } from "./favorites";
import type { TabsHandlers } from "./tabs";

type AppConfigDeps = {
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  tabsHandlers: Pick<TabsHandlers, "setSearchTab">;
};

export type AppConfigHandlers = ReturnType<typeof createAppConfigHandlers>;

export function createAppConfigHandlers(deps: AppConfigDeps) {
  const { elements, state, favoritesHandlers, tabsHandlers } = deps;

  function applyAppConfig(config: AppConfig) {
    state.appConfig = config;
    const allowUpload = Boolean(config.allow_user_upload);
    const allowUrl = Boolean(config.allow_user_url);
    const showUpload = allowUpload || allowUrl;
    elements.searchSubtabs.classList.toggle("hidden", !showUpload);
    elements.uploadFileSection.classList.toggle("hidden", !allowUpload);
    elements.uploadYoutubeSection.classList.toggle("hidden", !allowUrl);
    if (allowUpload) {
      const extList = (config.allowed_upload_exts || []).join(", ");
      const maxSize = config.max_upload_size
        ? `${Math.round(config.max_upload_size / (1024 * 1024))} MB`
        : "unknown";
      elements.uploadFileHint.textContent = `Max file size: ${maxSize}. Allowed: ${extList}`;
      elements.uploadFileInput.accept = (config.allowed_upload_exts || []).join(
        ",",
      );
    }
    if (!showUpload && state.searchTab === "upload") {
      tabsHandlers.setSearchTab("search");
    }
    tabsHandlers.setSearchTab(state.searchTab);
    favoritesHandlers.updateFavoritesSyncControls();
    if (config.allow_favorites_sync) {
      favoritesHandlers.hydrateFavoritesFromSync();
    }
  }

  return { applyAppConfig };
}
