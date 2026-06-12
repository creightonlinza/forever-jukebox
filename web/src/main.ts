import "./polyfills";
import "./style.css";
import { bootstrap } from "./app/bootstrap";
import { mountReactApp } from "./app/react-root";

// bootstrap queries the legacy panel elements, so it must run while they are
// still attached to the document; afterwards the nodes move into a fragment
// that the React shell adopts. Element references stay valid across the move.
const bridge = bootstrap();
const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("#app container missing");
}
const legacyContent = document.createDocumentFragment();
while (appEl.firstChild) {
  legacyContent.appendChild(appEl.firstChild);
}
mountReactApp(appEl, bridge, legacyContent);

const fontReady =
  "fonts" in document && typeof document.fonts?.ready?.then === "function"
    ? document.fonts.ready
    : Promise.resolve();
const revealTimeout = new Promise<void>((resolve) => {
  window.setTimeout(() => resolve(), 1500);
});

Promise.race([fontReady, revealTimeout]).finally(() => {
  document.documentElement.classList.remove("app-loading");
});
