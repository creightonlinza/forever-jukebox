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

## Active migration debt

None. The remaining React-migration leftovers have been cleared:

- pre-attach viz controllers are modeled as nullable until `attachViz` runs;
- the stats-panel pulse is driven by React-rendered store state;
- imperative handles live in their owning modules instead of the zustand store.

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
