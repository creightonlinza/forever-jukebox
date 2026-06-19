import "./polyfills";
import "./style.css";
import { initRuntime } from "./app/init";
import { mountReactApp } from "./app/react-root";

function reveal() {
  document.documentElement.classList.remove("app-loading");
}

try {
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

  Promise.race([fontReady, revealTimeout]).finally(reveal);
} catch (err) {
  // Never leave the page stuck at opacity 0 if startup fails — reveal so the
  // user sees a rendered error state rather than a blank screen.
  reveal();
  throw err;
}
