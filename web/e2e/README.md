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

## The deterministic engine lock

`engine-lock.spec.ts` pins engine output through the real UI. It serves the CC0
analysis embedded in `test-fixtures/engine-parity/real-analysis-cases.json` via
`page.route`, plus generated silence for the audio, so it needs no analyzed
track in the backend and its numbers cannot drift with the local DB. The branch
counts it asserts are the same fixture expectations that
`packages/shared/src/engine/realAnalysisParityFixtures.test.ts` replays through
the engine directly: a change in either layer alone fails. That unit test also
pins the seeded playback sequence (which branch is taken, not just how many
exist) and the edge ids the `d=` param deletes.

## Safety notes

- Tests are read-mostly. The mutating flows that would write junk to a shared
  backend are **network-mocked**: sync-code creation (`page.route` on
  `POST /api/favorites/sync`) and track deletion (`DELETE /api/jobs/*`
  fulfilled with 403). Favoriting/playlists only touch the browser profile,
  which Playwright resets per test.
- Play counts do get recorded when tests start playback — acceptable noise.

## Behavior notes pinned by these tests

- **All modals close on Escape**, trap Tab focus while open, and restore
  focus to the opener on close. With stacked modals (sleep timer over
  tuning) Escape closes only the topmost.
- `bp` (branch probability) serializes as unencoded commas (`bp=10,80,10`)
  and min/max swap-normalize on apply.
- Tuning **Reset preserves the `am` audio-mode param** while clearing the
  rest.
- Leaving the play tab strips query params; returning restores them.
- The CC0 fixture track computes a default threshold of 25 and the branch counts
  pinned in `real-analysis-cases.json`; changing them needs an intentional
  fixture update in both repos.
- `d=` edge ids are engine construction order, so they only stay valid while the
  precalculated edge list does.
