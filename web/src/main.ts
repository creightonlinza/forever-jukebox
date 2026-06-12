import "./polyfills";
import "./style.css";
import { bootstrap } from "./app/bootstrap";
import { mountReactRoot } from "./app/react-root";

bootstrap();
mountReactRoot();

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
