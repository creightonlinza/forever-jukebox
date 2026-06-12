import type { AppConfig } from "../api";
import type { AppState } from "../context";
import type { Elements } from "../elements";
import { configureMaxFavorites, maxFavorites } from "../favorites";
import { useAppStore } from "../store";
import type { FavoritesHandlers } from "./favorites";
import type { TabsHandlers } from "./tabs";

type AppConfigDeps = {
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  tabsHandlers: Pick<TabsHandlers, "setSearchTab">;
};

type ApplyAppConfigOptions = {
  hydrateFavorites?: boolean;
};

export type AppConfigHandlers = ReturnType<typeof createAppConfigHandlers>;

export function createAppConfigHandlers(deps: AppConfigDeps) {
  const { elements, state, favoritesHandlers, tabsHandlers } = deps;

  function applyAppConfig(
    config: AppConfig,
    options: ApplyAppConfigOptions = {},
  ) {
    state.appConfig = config;
    configureMaxFavorites(config.max_favorites);
    if (state.favorites.length > maxFavorites()) {
      favoritesHandlers.updateFavorites(state.favorites, { sync: false });
    }
    renderFooterCredit(config);
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
    if (options.hydrateFavorites !== false && config.allow_favorites_sync) {
      favoritesHandlers.hydrateFavoritesFromSync();
    }
  }

  // The footer is React-owned; <Footer> renders the credit from the store.
  function renderFooterCredit(config: AppConfig) {
    useAppStore.getState().setFooterCredit({
      hostedByName: config.hosted_by_name?.trim() || null,
      hostedByUrl: config.hosted_by_url?.trim() || null,
    });
  }

  return { applyAppConfig };
}
