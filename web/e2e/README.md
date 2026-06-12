# End-to-end tests (Playwright)

Full-app tests that drive the real UI against a real backend.

## Running locally (preferred)

```bash
cd web
npm run test:e2e          # boots ../dev.sh if the stack isn't already up
npm run test:e2e:ui       # interactive runner
```

Requirements:
- The backend must have **at least two analyzed tracks** (the suite discovers
  fixtures from `/api/top` at runtime — it never hardcodes job ids).
- Spotify search credentials configured (the search specs hit the real
  `/api/search`).

If `./dev.sh` is already running, Playwright reuses it.

## Running against a deployed environment

Pass the URL via the environment — it is intentionally not committed:

```bash
E2E_BASE_URL=https://<deployed-env> npx playwright test
```

## The full YouTube ingest flow

One opt-in spec (`youtube-analysis.spec.ts`) exercises upload-by-URL →
download → analysis → playback end-to-end with a short Creative-Commons
video. It downloads real audio and occupies the analysis worker for minutes,
so it is double-gated and meant **only for a deployed test environment**:

```bash
E2E_BASE_URL=https://<deployed-env> E2E_ALLOW_ANALYSIS=1 \
  npx playwright test e2e/youtube-analysis.spec.ts
```

## Safety notes

- Tests are read-mostly. The mutating flows that would write junk to a shared
  backend are **network-mocked**: sync-code creation (`page.route` on
  `POST /api/favorites/sync`) and track deletion (`DELETE /api/jobs/*`
  fulfilled with 403). Favoriting/playlists only touch the browser profile,
  which Playwright resets per test.
- Play counts do get recorded when tests start playback — acceptable noise.

## Behavior notes pinned by these tests

- The **tuning modal does not close on Escape** (the playlist and
  delete-confirm modals do). Legacy parity, pinned in `tuning.spec.ts`;
  candidate UX fix.
- Modals have **no focus trap** (legacy parity).
- `bp` (branch probability) serializes as unencoded commas (`bp=10,80,10`)
  and min/max swap-normalize on apply.
- Tuning **Reset preserves the `am` audio-mode param** while clearing the
  rest.
- Leaving the play tab strips query params; returning restores them.
