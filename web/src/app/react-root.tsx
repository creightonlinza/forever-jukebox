import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppRoot } from "./components/AppRoot";
import { setAppRouter } from "./router";

// Panels persist in the DOM; routes only select visibility. One catch-all
// route renders the whole shell — React Router never mounts/unmounts panels.
export function mountReactApp(container: HTMLElement) {
  const router = createBrowserRouter([
    {
      path: "*",
      element: <AppRoot />,
    },
  ]);
  setAppRouter(router);
  const root = createRoot(container);
  // Mount synchronously so <VizContainer>'s ref handoff constructs the viz
  // controllers before any queued microtask (config loads, favorites sync)
  // can reach code that needs them.
  flushSync(() => {
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  });
}
