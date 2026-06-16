# `web/` migration debt log

Debt **left over from the incremental migration to React** — patterns that exist
only because the app was ported from no-framework imperative code in stages, and
that a from-scratch React app wouldn't have. Roughly in priority order. The
headline item is removing the **`bootstrap` + `AppBridge` + `wire/*` seam**; the
rest are smaller remnants of the same migration.

Scope note: this log is *not* general tech debt. Things like oversized modules or
complex algorithms that would exist regardless of how the app was built are out
of scope here — see a general backlog for those. The test for inclusion is
"would this be here if the app had been written in React from day one?" If no,
it belongs here.

This is a working log, not a mandate — entries are things we'd want to fix if
touching that area, not a committed roadmap. We are **not** chasing "looks like
it was always 100% React"; the bar is "is this clean and maintainable."

---

## 1. The `AppBridge` + `bootstrap` + `wire/*` seam  — *high*

### What it is

`bootstrap.ts` (~390 LOC) imperatively builds one big `AppBridge` object and
threads it through **every** component as a `bridge` prop. Components dispatch
actions via `bridge.listenPanel.togglePlayback()` instead of importing an action
or calling a hook. The logic behind the bridge lives in imperative modules:

| Area | Files | LOC | Role |
|---|---|---|---|
| Seam | `bootstrap.ts`, `bridge.ts`, `wire/*` (7 files) | ~2,985 | wiring + handler factories |
| Playback flows | `playback/*` (10 files) | ~2,317 | orchestration as `(context, …) => …` |
| Other flows | `search.ts`, `upload.ts` | ~680 | search/upload flows |

### Why it's debt

A god-object passed by prop to every component is the one thing an experienced
React dev would flag and a newcomer would trip on. It also makes components hard
to test in isolation (every test fakes a `bridge`) and obscures data flow.

Good news: this is a **re-wiring job, not a rewrite.** State already lives in the
zustand store and every flow reads/writes it directly (the old `legacyAppState`
Proxy is gone). The work is changing *how each flow is reached*, then deleting
the seam.

### Established technique: "wire deps fold"

Commits `wire deps fold pass 1–4` set the direction: `wire/*` factories used to
receive collaborators as injected function params; each pass deletes those
params and imports the collaborator directly, shrinking `bootstrap.ts`. What's
left after folding is the **irreducible runtime**:

- the `AppContext` singleton (`engine`, `player`, `jukebox`, `autocanonizer`,
  `cowbellOverlay`, `defaultConfig`), and
- inter-handler closures (`getCurrentTrackId`, `setPlayMode`,
  `navigateToTabWithState`, `advancePlaylistOnAutocanonizerEnded`, …).

### Keystone: how React reaches the runtime without a prop

`AppContext` is just 6 genuine singletons. Two ways to expose them:

- **Option A — React Context provider.** `<AppRuntimeProvider>` + `useAppRuntime()`.
  Idiomatic; larger call-site churn.
- **Option B — module singleton (recommended).** `runtime.ts` with
  `setAppRuntime(ctx)` / `getAppContext()`; action modules read it internally so
  components import actions directly and call them with no args. Smallest diffs;
  continues the "fold" philosophy. Mildly less idiomatic than a provider —
  acceptable given we're not chasing purity.

> ⚠️ `jukebox`/`autocanonizer` don't exist until `<VizContainer>` hands over its
> DOM nodes (`attachViz`). Any accessor must tolerate "not attached yet" the way
> `context.jukebox = null` does today. Keep the synchronous `flushSync` mount.

### Template: cutting one panel off the bridge (Listen panel)

The Listen panel is the densest and most representative. Its `bridge.listenPanel`
surface (21 methods) splits in two:

**Kind 1 — direct module fns needing only `context`** (convert trivially once the
keystone lands; with Option B they drop the `context` arg entirely):
`togglePlayback`, `setSleepTimer`, `setVolume`, `getTuningForm`, `applyTuning`,
`resetTuning`, `getExtrasForm`, `applyExtras`, `resetExtras`.

**Kind 2 — handler-object methods** (need the owning `wire/*` factory relocated to
a module singleton, or promoted to a store action):

| `bridge.listenPanel.*` | Owning factory |
|---|---|
| `copyShortUrl`, `setPlayMode`, `setActiveVisualization`, `setCanonizerFinish`, `deleteSelectedBranch` | `wire/playback` |
| `playlistPrevious`/`Next`, `playlist.{selectIndex,removeIndex,clear}` | `wire/playlist` |
| `toggleFavorite` | `wire/favorites` |
| `getPendingDelete`, `performDelete` | `wire/delete-job` |
| `toggleFullscreen` | `wire/fullscreen` |

Plus direct runtime reaches: `bridge.context.jukebox/autocanonizer.resize*`
(`VizBottomRight`, `VizTop`) and the `bridge.attachViz` handoff (`VizContainer`).

Steps (generalize to every panel; only the method list changes):

1. Land the keystone (`runtime.ts`).
2. Convert Kind-1 calls to direct imports; drop the `context` param.
3. Relocate the Kind-2 factories to module singletons (or store actions where
   the method mostly flips store state + calls an engine method — good
   candidates: `setPlayMode`, `setActiveVisualization`, `setCanonizerFinish`).
4. Replace `bridge.context.*` reaches with `getAppContext()` (or move resize into
   the component's own effect/`ResizeObserver`).
5. Keep `attachViz` as a `<VizContainer>` ref callback, routed through `runtime.ts`.
6. Delete `ListenPanelBridge` from `bridge.ts` and the `listenPanel` block from
   `bootstrap.ts`; drop the `bridge` prop from the Listen tree.
7. Verify: `npm run typecheck && npm run lint && npm run test`. Update the
   `*.test.tsx` files to import modules/mocks instead of a fake `bridge`.

### Phased checklist (per-panel effort)

Targets: **import** = direct module-fn import · **action** = zustand store action
· **handler** = relocate the `wire/*` factory to a module singleton/hook.

- [x] **Phase 0 — keystone:** `runtime.ts` (`setAppRuntime`/`getAppContext`);
      bootstrap sets it; `attachViz` populates viz controllers through it. *(S, unblocks all)*
- [x] **Phase 1 — leaf panels:** `Hero.onHeroHomeClick` → action ·
      `TabBar.onTabClick` → action · `SleepTimerModal.setSleepTimer` → import. *(S)*
- [ ] **Phase 2 — Listen panel:** the template above; delete `ListenPanelBridge`. *(L)*
- [ ] **Phase 3 — Top Tracks:** `selectTrack`, `selectFavorite`, `addToPlaylist`,
      `removeFavorite`, `refreshFavoritesFromSync`, `enterSyncCode`,
      `createSyncCode` → handler (relocate `wire/favorites` + `wire/playlist`);
      delete `TopPanelBridge`. *(M)*
- [ ] **Phase 4 — Search/Upload:** `runSearch`, `selectSpotify`, `selectYoutube`
      → import (`search.ts`) · `uploadFile`, `uploadUrl` → import (`upload.ts`);
      delete `SearchPanelBridge`. *(M)*
- [ ] **Phase 5 — shell + teardown:** move `handleRoute`/`applyTheme`/`hotkeys`
      off `AppRoot` into hooks using `getAppContext()`/store actions; delete
      `bridge.ts` + `bootstrap.ts` (replace with a small `initRuntime()` from
      `main.ts`); collapse/empty `wire/`. *(M)*

### Guardrails
- One panel per commit; behavior-preserving.
- After each: `cd web && npm run typecheck && npm run lint && npm run test`.
- Fold only what the panel needs; don't refactor adjacent code.
- No dev-server smoke testing for verification — use the automated checks.

---

## 2. Parallel routing system  — *medium*

`router.ts` stashes the react-router instance in a module singleton
(`setAppRouter`/`getAppRouter`) so non-React modules can call `appNavigate()`,
and `tabs.ts` builds URLs by hand (`updateTrackUrl`, `navigateToTab`). This is a
second navigation path alongside react-router — same root cause as the bridge
(navigation logic lives outside React, calling back in).

- **Fix:** as flows convert (item 1), have them navigate via `useNavigate()`
  inside hooks/components instead of `appNavigate`. Largely resolves as a
  side effect of Phases 2–4, *if* we choose hooks over keeping module calls.
- **Risk if ignored:** two sources of truth for navigation; `appNavigate`'s
  raw-`history` fallback path is easy to forget.

---

## 3. `null as unknown as …` viz-controller casts  — *low*

`bootstrap.ts:104-105` seed `context.autocanonizer`/`context.jukebox` as
`null as unknown as AppContext["autocanonizer"]` because the controllers don't
exist until `attachViz`. The type system is told they're always present when
they aren't.

- **Fix:** model the pre-attach state honestly — either `jukebox: JukeboxController | null`
  on `AppContext` (and handle null at call sites), or split "pre-attach" vs
  "attached" runtime types. Naturally addressed by the Phase-0 `runtime.ts`
  accessor (which has to express "not attached yet" anyway).

---

## 4. Last UI-state DOM poke outside React  — *low*

`playback/status-ui.ts` pulses the stats panel via
`document.getElementById("viz-stats")` + `classList`. It's the only remaining
*UI-state* DOM mutation outside the React tree (theme CSS-vars and the marquee
hook are legitimate escape-hatches; leave those).

- **Fix:** drive the pulse from store state → a `className` on the
  already-React-rendered `#viz-stats` element in `VizContainer`.

---

## 5. Non-serializable handles in the store  — *low / maybe accept*

The zustand store holds `AbortController` (`pollController`), timer ids
(`toastTimer`, `listenTimerId`, `sleepTimerTimeoutId`) and `wakeLock`. These were
carried over verbatim from the pre-React mutable `AppState`/`context` object when
it was ported into zustand — migration origin, not a fresh design choice. Works
fine (no devtools/persist middleware serializes them) and `store.ts` notes it,
but it's slightly unusual — a reviewer will pause on it.

- **Option:** move the genuinely imperative handles into the `runtime.ts` module
  (item 1) or refs, keeping the store to serializable-ish UI/domain state.
- **Or:** accept it and keep the existing note. Low value either way.

---

## Explicitly out of scope / accepted decisions

So these read as choices, not oversights:

- **"Always looked 100% React" purity goal — dropped.** Git history shows a
  migration; that's fine. We optimize for clean current code, not erasing the
  migration's fingerprints.
- **Always-mounted panels hidden via `.hidden` / body classes** — deliberate.
  The viz especially must stay mounted to preserve canvas/WebGL state; routes
  select visibility rather than mount/unmount. Keep.
- **`id=`/class hooks into the global `style.css`** — components carry stable ids
  matching existing CSS. Not converting to CSS modules / scoped styles.
- **`cast/` is a separate vanilla-JS entry point** (Chromecast receiver). Not
  React, by design; out of scope.
</content>
