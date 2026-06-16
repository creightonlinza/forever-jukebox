import type { AppContext } from "./context";

// Module-singleton access to the genuine runtime singletons (engine, player,
// jukebox, autocanonizer, cowbellOverlay, defaultConfig). This is the keystone
// for retiring the AppBridge + bootstrap + wire/* seam: once it's in place,
// flow modules and components can reach the runtime via getAppContext() instead
// of receiving an injected `context` arg or the `bridge` prop. See
// web/TECH_DEBT.md item 1 (Phase 0).
//
// bootstrap() owns construction and calls setAppRuntime(context) before any
// React effect can run. The viz controllers (jukebox/autocanonizer) don't exist
// until <VizContainer> hands over its DOM nodes (attachViz); bootstrap mutates
// the same `context` object this holds, so getAppContext() observes them as
// soon as attachViz fills the slots — matching today's `context.jukebox = null`
// pre-attach behavior.

let appContext: AppContext | null = null;

export function setAppRuntime(context: AppContext): void {
  appContext = context;
}

export function getAppContext(): AppContext {
  if (!appContext) {
    throw new Error(
      "App runtime not initialized; setAppRuntime() must run in bootstrap before getAppContext().",
    );
  }
  return appContext;
}
