# React Migration Plan — `web/`

Strategy: **incremental, in-place**. React is added to the existing Vite app and takes over the page region by region. The app stays shippable after every phase. The PWA is untouched.

## Scope

**Converts:** app shell, tab navigation, routing, the four tab panels, modals/overlays, toast, state wiring (`bootstrap.ts`, `elements.ts`, `wire/*`, `tabs.ts`, `routing.ts`, `ui.ts`).

**Does NOT convert (by design):**
- `engine/`, `audio/`, `jukebox/JukeboxViz`, `autocanonizer/*Viz` — framework-agnostic playback/canvas code. React only mounts and talks to it.
- `cast/` — separate entry (`cast-receiver.html`) for the Chromecast runtime, with its own `main.ts` and `tuning.ts`. Zero benefit from React; leave vanilla.
- `legacy/` — untouched.
- `api.ts` — already a clean typed fetch layer; consumed as-is by store actions. Do NOT add TanStack Query during the migration; revisit later if caching/retry needs grow.
- `style.css` — components keep the existing class names. No CSS modules, no Tailwind, no restyling during migration. Visual diffs should be zero.

---

## Critical architectural decision: panels persist, routes select

Today, tab switching toggles a `hidden` class (`setActiveTab` in `tabs.ts`); **all four panels stay in the DOM permanently**. This matters:

- The viz canvases (`#viz-layer`, `#canonizer-layer`) hold WebGL/canvas + controller state. Unmounting the Listen panel on tab switch would destroy playback visuals mid-song.
- `JukeboxController.resizeActive()` is called when returning to the play tab — it assumes the canvas node survived.
- The play tab button shows an `is-playing` indicator while audio runs on other tabs.

**Therefore: do NOT use React Router's element-per-route rendering for panels.** Instead, all four panels render always under one layout; the route determines which panel is visible (CSS, same as today). React Router is used for URL parsing/navigation only — `useLocation`/`useNavigate` drive an `activeTab` derivation, panels get `hidden` from it. This is non-negotiable until/unless the viz layer gets explicit mount/unmount lifecycle support (out of scope).

---

## Workflow

All work happens on a single long-lived branch (e.g. `react-migration`), advanced as a sequence of checkpoint commits — one per step in the sequence table at the bottom. Rules that replace PR discipline:

- **Every checkpoint commit leaves the app fully working** — the per-checkpoint checklist (end of doc) must pass before committing. No "WIP, fixed in next commit" states; if the branch dies at any commit, what's there is shippable.
- Tag or note milestone commits (post-Phase 2, post-Phase 3) so there are known-good bisect anchors.
- Rebase the branch on main regularly; `index.html` and `style.css` are the conflict magnets, so merge main before starting each panel conversion, not after.
- A checkpoint can be several small commits, but the checklist gates the checkpoint boundary.

## Phase 1 — Tooling (checkpoint 1, no behavior change)

- Add `react`, `react-dom`, `react-router-dom@6`, `zustand`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`. Match the PWA's versions (`react@^18.3.1`, `react-router-dom@^6.27.0`) so knowledge transfers between apps.
- `tsconfig.json`: add `"jsx": "react-jsx"`. ESLint: add `eslint-plugin-react-hooks` (the PWA's `eslint.config.mjs` is the template).
- Tests: add `@testing-library/react`, `@testing-library/user-event`, `jsdom`. Current tests run in node env with a hand-rolled fake `window` (`src/app/__tests__/test-utils.ts`). Use vitest `environmentMatchGlobs` (or test projects): `**/*.test.tsx` → jsdom, `**/*.test.ts` → node. Don't migrate existing tests to jsdom; they pass as-is.
- `@vitejs/plugin-legacy` (chrome 63 target) coexists with `@vitejs/plugin-react` — legacy transforms run at build output stage. Verify: legacy build still produces both `main` and `cast` entries, and measure bundle delta (React 18 ≈ 45 kB gz; acceptable but record it). The existing `src/polyfills.ts` (core-js, abortcontroller) stays imported first in `main.ts`/root module.
- Proof: render `<React.StrictMode><div/></React.StrictMode>` into a placeholder div next to `#app`. Note: **StrictMode double-invokes effects in dev** — every imperative bridge (viz mount, engine init) must be idempotent or guarded. Decide StrictMode on/off at this checkpoint and stick with it (recommended: on, it catches exactly the bugs this migration can create).

## Phase 2 — App shell + routing (checkpoint 2, the structural one)

- `src/app/AppRoot.tsx` renders inside `BrowserRouter`. `index.html` keeps: the FOUC guard (`app-loading` class inline script + style — `main.ts` removes it on `document.fonts.ready`, keep that logic verbatim), font preconnects/links (Barlow, Tilt Neon, Material Symbols), favicon, and meta. Body markup migrates into JSX per-panel in Phase 4, **not** at this checkpoint. Here React owns only: header/hero, tab bar, footer, and a passthrough container that wraps the existing static panels untouched.
- **URL contract (frozen — codify in router tests before deleting `routing.ts`/`tabs.ts`):**

  | Path | Meaning |
  |---|---|
  | `/` | Top Tracks tab |
  | `/search` | Search tab |
  | `/listen` | Listen tab, no track |
  | `/listen/:trackId` | Listen tab + load track (`decodeURIComponent`, fall back to raw on failure — see `handleRouteChange`) |
  | `/faq`, `/whats-new` | FAQ tab, subtab from path (`pathForFaqSubtab`) |

  Query params on `/listen` (from `tuning.ts`, keys `TUNING_PARAM_KEYS = ["jb","lg","sq","thresh","bp","d","am","ab"]` plus play-mode param): preserved on tab navigation to play, **stripped** when navigating to other tabs (current `navigateToTab` behavior: `url.search = ""` unless play). `am` accepts the audio-mode enum (`off|nightcore|daycore|vaporwave|eight_d|eight_bit|lofi|underwater|cathedral|cowbell|swing`). `updateTrackUrl` semantics (replace vs push, `serializeParams` ordering) must survive — port `tabs.ts`'s pure helpers (`pathForTab`, `urlForTrack`, `buildSearchParams`) as-is; only the `history.pushState` plumbing is replaced by `useNavigate`.
- `isLikelyJobId` (32-hex check in `identity.ts`) gates job-vs-track loading in route handling — port untouched.
- Tab bar component replaces `wire/tabs.ts` class-toggling; includes the responsive label spans (`tab-label-top-full/short`) and the external "Offline App" link (it's a link, not a route).
- Side effects currently in `setActiveTab` move to a store subscription or effect keyed on `activeTab`: top-songs refresh timer arm/disarm (`TOP_SONGS_REFRESH_MS`), `jukebox.resizeActive()` on entering play, clearing `shiftBranching` + `engine.setForceBranch(false)` and `selectedEdge` when leaving play.
- Keep `vite.config.ts`'s `castRewritePlugin` and dual rollup inputs unchanged. The `/api`, `/sitemap.xml`, `/robots.txt` proxies are routing-irrelevant but verify hard loads of `/listen/:id` still serve `index.html` in dev and prod (SPA fallback).

## Phase 3 — State: Zustand store

- Port `AppState` (`context.ts`, ~50 fields) into one store with slices. Mapping:

  | Slice | Fields from `AppState` |
  |---|---|
  | `ui` | `activeTabId`, `topSongsTab`, `searchTab`, `activeVizIndex`, `toastTimer`, `selectedEdge` |
  | `playback` | `isRunning`, `isPaused`, `playMode`, `playTimerMs`, `lastPlayStamp`, `lastBeatIndex`, `vizData`, `shiftBranching`, `bringItHomeMode`, `jukeboxAudioMode`, `swingPreparing`, `swingRenderToken`, `sleepTimer`, `sleepTimerTimeoutId`, `wakeLock`, `listenTimerId` |
  | `track` | `audioLoaded`, `analysisLoaded`, `audioLoadInFlight`, `lastJobId`, `lastTrackId`, `lastSourceId`, `lastSourceProvider`, `trackTitle`, `trackArtist`, `trackDurationSec`, `lastPlayCountedJobId`, `deleteEligible`, `deleteEligibilityJobId`, `pollController` |
  | `tuning` | `tuningParams`, `autoComputedThreshold`, `deletedEdgeIds`, `highlightAnchorBranch`, `branchStatsEnabled` |
  | `library` | `favorites`, `playlist`, `favoritesSyncCode`, `pendingAutoFavoriteId`, `topSongsRefreshTimer` |
  | `config` | `appConfig` |

  Non-serializable handles (`pollController: AbortController`, `wakeLock: WakeLockSentinel`, timer ids) are fine in Zustand but exclude them from any devtools serialization.
- **Why Zustand:** the engine/audio layer writes state from outside React — beat callbacks, `pollAnalysis` loops, sleep/listen timers, `backgroundTimer`. `useStore.getState()/setState()` work in plain TS modules, so `playback.ts` becomes the store's action layer without rewriting it. High-frequency values (`vizData`, `lastBeatIndex`, `playTimerMs` ticking) need care: subscribe with selectors + shallow equality; consider `subscribeWithSelector` and writing beat-rate data via a transient (non-reactive) path or throttled updates so React isn't rendering 4×/sec on the beat.
- `playback.ts` (1,823 lines) is NOT rewritten now: replace its `state.x = y` mutations and DOM writes (status text, progress, buttons) with store writes; React renders them. Direct canvas/viz calls stay imperative.
- Singleton construction replaces `bootstrap.ts`'s build phase, preserving order: `initBackgroundTimer()` → theme applied pre-paint → `new BufferedAudioPlayer()` → `CowbellOverlayService(player.getContext(), …)` → `JukeboxEngine(player, { randomMode: "random" })` → controllers. Controllers need DOM nodes (`AutocanonizerController(canonizerLayer)`, `JukeboxController(vizLayer)`), which now exist only after first render — so split construction: audio/engine singletons at module scope, controllers lazily in the `<VizContainer>` ref callback (guarded for StrictMode double-mount). A `useJukebox()` hook (or plain module export) exposes them.
- `attachVisualizationResize`'s ResizeObserver on `#viz-panel` becomes a `useResizeObserver` effect in `<VizContainer>`.
- **Persistence keys are part of the contract — never rename:** localStorage `fj-theme`, `fj-admin-key`, `fj-branch-stats-enabled`, `fj-highlight-anchor-branch`, `fj-viz`, `fj-canonizer-finish`, `fj-favorites`, `fj-favorites-sync`, `fj-playlist`; IndexedDB `forever-jukebox-cache` v2 (stores `tracks` with legacy keyPath `youtubeId`, and `app-config`). Don't adopt Zustand's `persist` middleware unless it writes these exact keys/formats; safer to keep the existing read/write helpers (`favorites.ts`, `playlist.ts`, `cache.ts`, `admin.ts`, etc.) and call them from store actions.

## Phase 4 — Main components (one checkpoint per panel, easiest → hardest)

1. **FAQ panel** — static content + `faq`/`whats-new` subtabs. Lowest risk; proves the recipe.
2. **Top Tracks panel** — `top`/`trending`/`recent`/`favorites` subtabs (`setTopSongsTab` logic: list visibility, dynamic title `Top ${TOP_SONGS_LIMIT}`/`Trending`/`Last N Played`/`Favorites`, refresh-button visibility + aria-label), lazy per-subtab loading (`loadedTopSongTabs` set in bootstrap), refresh timer, favorites filter, favorites-sync create/enter modals + menu. Replaces `wire/top-songs.ts` and most of `wire/favorites.ts` (1,053 lines — largely manual list-DOM building that JSX deletes outright).
3. **Search/Upload panel** — query form, Spotify/YouTube results, upload flow (`uploadAudio`, `startUrlAnalysis`), admin delete affordances (`fj-admin-key` gating). Replaces `wire/search.ts`, parts of `wire/delete-job.ts`.
4. **Listen panel** — converted as five sub-checkpoints (8a–8e below), not one. For this panel only, the ownership rule refines from per-panel to **per-DOM-subtree**: a designated subtree (a modal, the volume panel, the transport bar, the viz layer) is fully React or fully legacy, and when a subtree converts, every legacy reference into it (its `elements.ts` entries, its `wire/*` listeners) is removed **in the same commit**. Converted in ascending order of imperative entanglement:
   - **8a. Modals + menus** (one commit each or batched): tuning modal (sliders ↔ URL params two-way), info modal, playlist modal, sleep-timer modal, play menu. Overlays are self-contained subtrees with no canvas interplay — they read/write only store state and `playback.ts` actions already routed through the store in Phase 3. Replaces `wire/tuning.ts` and the modal portions of `wire/ui.ts`/`wire/playback.ts`.
   - **8b. Volume panel + fullscreen control.** Small, isolated. Replaces `wire/fullscreen.ts`.
   - **8c. Track info + counters**: marquee title/artist (`useMarquee`), listen-time/beats display, analysis status, loading progress. Pure render-from-store; no handlers beyond refresh.
   - **8d. Transport + mode controls**: play/pause, branch (shift), jukebox/autocanonizer switching, viz selector. Handlers call existing `playback.ts` actions; the buttons' `is-playing`/disabled states come from the store.
   - **8e. `<VizContainer>`** — renders bare divs for `#viz-layer`/`#canonizer-layer` and hands nodes to `JukeboxController`/`AutocanonizerController` via ref callback — canvas code untouched, **never remounted** (StrictMode-guarded). Last because it's the only step that touches controller construction. Deletes the final `elements.ts` entries and the rest of `wire/playback.ts`/`wire/ui.ts`.
5. **Cross-cutting** —
   - **Modals** (9: `info`, `tuning`, `playlist`, `sleep-timer`, `delete-confirm`, `favorites-sync-create`, `favorites-sync-enter`, `favorites-sync-menu`, `play-menu`): build one `<Modal>` primitive first (focus trap, Escape, backdrop click — current behavior lives in `wire/ui.ts`'s 68 listener registrations), then convert each as its panel converts.
   - **Global hotkeys**: `wire/ui.ts` registers window-level `keydown` for playback shortcuts and delete-confirm, guarded by `isEditableTarget`. Becomes a `useGlobalHotkeys` hook mounted once in `AppRoot`; port `isEditableTarget` and `blurMouseActivatedControl` as-is.
   - **Theme** (`wire/theme.ts` + `theme.ts`): keep `applyThemeVariables` (writes CSS custom properties to `documentElement` — fine to keep imperative), drive from a store value + effect; preserve pre-first-paint application (read `fj-theme` before render, e.g. in the entry module) to avoid theme flash; `jukebox.refresh()` after change.
   - **Toast** (`showToast` + `toastTimer`): store-driven `<Toast>`.
   - **Marquee** (`marquee.ts`, WeakMap of per-element controllers): keep the imperative controller, wrap in a `useMarquee(ref, text)` hook.
   - `setAnalysisStatus`/`setLoadingProgress`/`errorDisplay`: become rendered store state.

**Panel conversion recipe (repeat per panel):** move the panel's HTML from `index.html` into JSX (preserve ids/classes initially — CSS and any analytics depend on them) → replace its `wire/*` file with component handlers calling store actions → delete its entries from `elements.ts` → replace its wire tests with Testing Library tests. `elements.ts` (794 lines / ~150 `requireElement` calls) shrinking to empty is the progress meter.

**Interim rule:** React must never re-render a DOM subtree that imperative code holds element references to. Ownership is per-panel and absolute — a panel is fully React or fully legacy. No mixed panels. (Sole exception: the Listen panel in checkpoints 8a–8e, where ownership is tracked per designated subtree as described above — same invariant, finer granularity.) During the interim, legacy panels live inside `dangerouslySetInnerHTML`-free static containers: keep them as real HTML in `index.html` under the React-rendered layout via a portal-less passthrough (`<div ref>` that adopts the existing nodes) — simplest is to leave legacy panel markup in `index.html` and have React render around it until that panel's checkpoint.

## Phase 5 — Cleanup + future work

- Delete `bootstrap.ts`, `elements.ts`, `wire/`, `tabs.ts`/`routing.ts` remnants, `dom.ts`; audit `style.css` (2,376 lines) for dead selectors — audit, don't rewrite.
- Future (explicitly out of scope now): split Listen panel into smaller components; decompose `playback.ts` into per-slice action modules; route-level code splitting (only after panels-persist constraint is rethought); evaluate sharing `engine/`/`audio/` with the PWA via a workspace package; consider TanStack Query for top-songs/search fetching.

## Risks / verification

- **Regression surface is the Listen panel** — audio timing, wake lock, sleep timer, swing render token races, viz interplay. Mitigations: converted last; engine untouched; store bridge proven on three panels first; panels-persist rule prevents canvas teardown.
- **StrictMode double-effects** can double-construct controllers or double-arm timers — every bridge effect needs cleanup/idempotency.
- **Render-frequency**: beat-rate store writes must not cause app-wide renders; use selector subscriptions and throttle counters (listen time ticks 1 Hz — fine; `vizData`/beat index need transient handling).
- **Tests:** pure-logic tests (`format`, `search`, `cache`, `tuning`, `engine/*`, `audio/*`, `cast/*`) survive unchanged. Never delete a `wire/*` test before its Testing Library replacement exists. `routing.test.ts`/`tabs.test.ts` become router tests first (Phase 2), then the old ones are removed.
- **SEO/deep links:** hard loads of `/listen/:trackId`, `/search`, `/faq`, `/whats-new` must serve the SPA; sitemap/robots stay proxied to the API.
- **Per-checkpoint checklist:** `npm run typecheck && npm run lint && npm test`; production build including legacy chunks and cast entry; manual smoke: load a track via deep link with tuning params, play, branch (shift), open tuning modal and verify URL updates, theme toggle, sleep timer, favorites add/sync, cast page loads.

## Checkpoint sequence (rough sizing)

| # | Checkpoint | Size |
|---|---|---|
| 1 | Tooling: deps, tsconfig/eslint, vitest envs, hello-world root | S |
| 2 | Shell + router: AppRoot, tab bar, URL contract tests, panels passthrough | L |
| 3 | Zustand store + `playback.ts` writes through store; no visible change | L |
| 4 | FAQ panel | S |
| 5 | Top Tracks panel (+ favorites lists, sync modals) | L |
| 6 | Search/Upload panel | M |
| 7 | Modal primitive + toast + theme + hotkeys hooks | M |
| 8a | Listen: modals + menus (tuning, info, playlist, sleep-timer, play menu) | M |
| 8b | Listen: volume panel + fullscreen | S |
| 8c | Listen: track info, marquee, counters, status | S |
| 8d | Listen: transport + mode controls | M |
| 8e | Listen: VizContainer + controller ref handoff; delete last wire/elements code | M |
| 9 | Cleanup: delete bootstrap/elements/wire, CSS audit | M |
