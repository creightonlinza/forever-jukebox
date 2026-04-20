import type { AppContext } from "../context";
import type { PlaybackUiHandlers } from "./playback";
import type { PlaybackDeps } from "../playback";
import type { FaqSubtabId } from "../tabs";

type RoutingDeps = {
  context: AppContext;
  playbackHandlers: Pick<PlaybackUiHandlers, "applyModeFromUrl">;
  handleRouteChange: (
    context: AppContext,
    playbackDeps: PlaybackDeps,
    path: string,
  ) => Promise<void>;
  playbackDeps: PlaybackDeps;
  onFaqRoute?: (subtabId: FaqSubtabId) => void;
};

export type RoutingHandlers = ReturnType<typeof createRoutingHandlers>;

export function createRoutingHandlers(deps: RoutingDeps) {
  const {
    context,
    playbackHandlers,
    handleRouteChange,
    playbackDeps,
    onFaqRoute,
  } = deps;

  function handlePopState() {
    const path = window.location.pathname;
    playbackHandlers.applyModeFromUrl();
    handleRouteChange(context, playbackDeps, path)
      .then(() => {
        if (path.startsWith("/faq")) {
          onFaqRoute?.("faq");
          return;
        }
        if (path.startsWith("/whats-new")) {
          onFaqRoute?.("whats-new");
        }
      })
      .catch((err) => {
        console.warn(`Route load failed: ${String(err)}`);
      });
  }

  return { handlePopState };
}
