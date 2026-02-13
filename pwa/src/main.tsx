import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import { initBackgroundTimer } from "@/shared/jukebox/background/backgroundTimer";
import "@/app/styles.css";

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });
}

initBackgroundTimer();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
