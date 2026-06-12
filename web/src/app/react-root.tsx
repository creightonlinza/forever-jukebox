import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Checkpoint 1 proof: React renders alongside the vanilla app without
// touching it. StrictMode is ON for the whole migration — it double-invokes
// effects in dev, so every imperative bridge must be idempotent or guarded.
export function mountReactRoot(): void {
  const app = document.getElementById("app");
  if (!app) return;
  const host = document.createElement("div");
  host.id = "react-root";
  app.insertAdjacentElement("afterend", host);
  createRoot(host).render(
    <StrictMode>
      <div />
    </StrictMode>,
  );
}
