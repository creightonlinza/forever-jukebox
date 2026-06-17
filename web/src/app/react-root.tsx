import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppRoot } from "./components/AppRoot";
import { useAppStore } from "./store";
import { tabFromPathname } from "./tabs";

// One catch-all route renders the shell. Regular tab panels mount only while
// active; the Listen/viz panel is the explicit keep-alive exception.
export function mountReactApp(container: HTMLElement) {
  useAppStore.getState().setActiveTab(tabFromPathname(window.location.pathname));
  const router = createBrowserRouter([
    {
      path: "*",
      element: <AppRoot />,
    },
  ]);
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
