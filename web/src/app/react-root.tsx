import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import type { AppBridge } from "./bridge";
import { AppRoot } from "./components/AppRoot";
import { setAppRouter } from "./router";

// Panels persist in the DOM; routes only select visibility. One catch-all
// route renders the whole shell — React Router never mounts/unmounts panels.
export function mountReactApp(
  container: HTMLElement,
  bridge: AppBridge,
  legacyContent: DocumentFragment,
) {
  const playMenuRoot = legacyContent.querySelector("#play-menu-root");
  const vizBottomRightRoot = legacyContent.querySelector(
    "#viz-bottom-right-root",
  );
  const router = createBrowserRouter([
    {
      path: "*",
      element: (
        <AppRoot
          bridge={bridge}
          legacyContent={legacyContent}
          playMenuRoot={playMenuRoot}
          vizBottomRightRoot={vizBottomRightRoot}
        />
      ),
    },
  ]);
  setAppRouter(router);
  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
