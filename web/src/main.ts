import "./polyfills";
import "./style.css";
import { initRuntime } from "./app/init";
import { mountReactApp } from "./app/react-root";

initRuntime();
const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("#app container missing");
}
mountReactApp(appEl);

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
