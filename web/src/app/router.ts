import type { createBrowserRouter } from "react-router-dom";

export type AppRouter = ReturnType<typeof createBrowserRouter>;

let appRouter: AppRouter | null = null;

export function setAppRouter(router: AppRouter | null) {
  appRouter = router;
}

export function getAppRouter(): AppRouter | null {
  return appRouter;
}

// Imperative navigation entry point for non-React modules (playback, search,
// favorites, …). Routes through React Router when mounted; falls back to raw
// history calls otherwise (e.g. node-env unit tests with a fake window).
export function appNavigate(to: string, options?: { replace?: boolean }) {
  if (appRouter) {
    void appRouter.navigate(to, { replace: options?.replace });
    return;
  }
  const url = new URL(to, window.location.href);
  if (options?.replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}
