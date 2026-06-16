# `web/` migration debt log

Debt **left over from the incremental migration to React** — patterns that exist
only because the app was ported from no-framework imperative code in stages, and
that a from-scratch React app wouldn't have. Roughly in priority order.

Scope note: this log is *not* general tech debt. Things like oversized modules or
complex algorithms that would exist regardless of how the app was built are out
of scope here — see a general backlog for those. The test for inclusion is
"would this be here if the app had been written in React from day one?" If no,
it belongs here.

This is a working log, not a mandate — entries are things we'd want to fix if
touching that area, not a committed roadmap. We are **not** chasing "looks like
it was always 100% React"; the bar is "is this clean and maintainable."

---

## 1. `null as unknown as ...` viz-controller casts  — *low*

`init.ts` seeds `context.autocanonizer`/`context.jukebox` as
`null as unknown as AppContext[...]` because the controllers don't exist until
`attachViz`. The type system is told they're always present when they aren't.

- **Fix:** model the pre-attach state honestly — either `jukebox: JukeboxController | null`
  on `AppContext` (and handle null at call sites), or split "pre-attach" vs
  "attached" runtime types.

---

## 2. Last UI-state DOM poke outside React  — *low*

`playback/status-ui.ts` pulses the stats panel via
`document.getElementById("viz-stats")` + `classList`. It's the only remaining
*UI-state* DOM mutation outside the React tree (theme CSS-vars and the marquee
hook are legitimate escape-hatches; leave those).

- **Fix:** drive the pulse from store state → a `className` on the
  already-React-rendered `#viz-stats` element in `VizContainer`.

---

## 3. Non-serializable handles in the store  — *low / maybe accept*

The zustand store holds `AbortController` (`pollController`), timer ids
(`toastTimer`, `listenTimerId`, `sleepTimerTimeoutId`) and `wakeLock`. These were
carried over verbatim from the pre-React mutable `AppState`/`context` object when
it was ported into zustand — migration origin, not a fresh design choice. Works
fine (no devtools/persist middleware serializes them) and `store.ts` notes it,
but it's slightly unusual — a reviewer will pause on it.

- **Option:** move the genuinely imperative handles into the `runtime.ts` module
  or refs, keeping the store to serializable-ish UI/domain state.
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
