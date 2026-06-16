import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";

// Module-singleton access to the genuine runtime singletons (engine, player,
// jukebox, autocanonizer, cowbellOverlay, defaultConfig). initRuntime owns
// construction; flow modules and components read the runtime via
// getAppContext() instead of receiving an injected `context` arg or bridge prop.
//
// initRuntime() owns construction and calls setAppRuntime(context) before any
// React effect can run. The viz controllers (jukebox/autocanonizer) don't exist
// until <VizContainer> hands over its DOM nodes (attachViz); init mutates
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
      "App runtime not initialized; setAppRuntime() must run in init before getAppContext().",
    );
  }
  return appContext;
}

export function getAttachedAppContext(): AppContext | null {
  if (!appContext?.jukebox || !appContext.autocanonizer) {
    return null;
  }
  return appContext;
}

let playbackDeps: PlaybackDeps | null = null;

export function setPlaybackDeps(deps: PlaybackDeps): void {
  playbackDeps = deps;
}

export function getPlaybackDeps(): PlaybackDeps | null {
  return playbackDeps;
}

// <VizContainer>'s ref handoff. The construction logic lives in init (it
// wires the viz controllers into the playback handlers and document listeners),
// but components reach it through this singleton instead of the bridge prop.
export type AttachVizNodes = {
  vizPanel: HTMLElement;
  vizLayer: HTMLDivElement;
  canonizerLayer: HTMLDivElement;
};

let attachVizFn: ((nodes: AttachVizNodes) => void) | null = null;
let vizPanel: HTMLElement | null = null;

export function setAttachViz(fn: (nodes: AttachVizNodes) => void): void {
  attachVizFn = fn;
}

export function attachViz(nodes: AttachVizNodes): void {
  vizPanel = nodes.vizPanel;
  attachVizFn?.(nodes);
}

export function getVizPanel(): HTMLElement | null {
  return vizPanel;
}

let advancePlaylistOnAutocanonizerEndedFn:
  | (() => Promise<boolean>)
  | null = null;

export function setAdvancePlaylistOnAutocanonizerEnded(
  fn: () => Promise<boolean>,
): void {
  advancePlaylistOnAutocanonizerEndedFn = fn;
}

export function advancePlaylistOnAutocanonizerEnded(): Promise<boolean> {
  return advancePlaylistOnAutocanonizerEndedFn?.() ?? Promise.resolve(false);
}

// applyModeFromUrl + handleRouteChange — runs on initial load and browser
// back/forward (POP). The React shell's route-sync effect calls this; the
// implementation (which needs the playback flow deps) is registered by init.
let routeHandlerFn: ((pathname: string) => void) | null = null;

export function setRouteHandler(fn: (pathname: string) => void): void {
  routeHandlerFn = fn;
}

export function handleRoute(pathname: string): void {
  routeHandlerFn?.(pathname);
}
