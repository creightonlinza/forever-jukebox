import type { AppConfig } from "../api";
import { configureMaxFavorites, maxFavorites } from "../favorites";
import { useAppStore } from "../store";
import type { FavoritesHandlers } from "./favorites";

type AppConfigDeps = {
  favoritesHandlers: Pick<
    FavoritesHandlers,
    "updateFavorites" | "hydrateFavoritesFromSync"
  >;
};

type ApplyAppConfigOptions = {
  hydrateFavorites?: boolean;
};

export type AppConfigHandlers = ReturnType<typeof createAppConfigHandlers>;

export function createAppConfigHandlers(deps: AppConfigDeps) {
  const { favoritesHandlers } = deps;

  // Upload-section visibility/hints and the footer credit render in React
  // from appConfig/footerCredit store state.
  function applyAppConfig(
    config: AppConfig,
    options: ApplyAppConfigOptions = {},
  ) {
    useAppStore.setState({ appConfig: config });
    configureMaxFavorites(config.max_favorites);
    if (useAppStore.getState().favorites.length > maxFavorites()) {
      favoritesHandlers.updateFavorites(useAppStore.getState().favorites, { sync: false });
    }
    useAppStore.getState().setFooterCredit({
      hostedByName: config.hosted_by_name?.trim() || null,
      hostedByUrl: config.hosted_by_url?.trim() || null,
    });
    const allowUpload = Boolean(config.allow_user_upload);
    const allowUrl = Boolean(config.allow_user_url);
    const showUpload = allowUpload || allowUrl;
    if (!showUpload && useAppStore.getState().searchTab === "upload") {
      useAppStore.setState({ searchTab: "search" });
    }
    if (options.hydrateFavorites !== false && config.allow_favorites_sync) {
      favoritesHandlers.hydrateFavoritesFromSync();
    }
  }

  return { applyAppConfig };
}
