# Forever Jukebox PWA (Offline Only)

This is a standalone, offline-first desktop PWA for local audio only. It runs the Forever Jukebox analysis pipeline entirely in the browser, in a dedicated worker, and never talks to any backend.

## Quick start

```bash
cd pwa
npm install
npm run dev
```

Build + preview:

```bash
npm run build
npm run preview
```

Tests:

```bash
npm run test
```

## Install as a desktop PWA

1. Open the app in Chrome or Edge.
2. Use the Install button in the header or the browser install icon.
3. Launch from your OS app list.

## Offline behavior

- The app shell and assets are precached via Workbox (vite-plugin-pwa).
- Once installed, navigations and assets are served cache-only.
- Network requests to non-self origins are blocked at runtime and by CSP.

## Analysis storage

- Cached analysis is stored by fingerprint (name + size + lastModified + hash of first bytes).
- Storage uses OPFS when available, otherwise IndexedDB.

## Reused modules and origins

- `src/shared/jukebox/engine/*`
  Copied from `web/src/engine/*` on 2026-02-11.
- `src/shared/jukebox/viz/JukeboxViz.ts`
  Copied from `web/src/jukebox/JukeboxViz.ts` on 2026-02-11.
- `src/shared/jukebox/viz/JukeboxController.ts`
  Copied from `web/src/jukebox/JukeboxController.ts` on 2026-02-11.
- `src/shared/jukebox/audio/BufferedAudioPlayer.ts`
  Copied from `web/src/audio/BufferedAudioPlayer.ts` on 2026-02-11.
- `src/shared/jukebox/background/backgroundTimer.ts`
  Copied from `web/src/shared/backgroundTimer.ts` on 2026-02-11.
- `src/shared/jukebox/constants/visualization.ts`
  Copied from `web/src/app/constants.ts` on 2026-02-11.
- `src/workers/essentia.worker.ts`
  Copied from `web/src/workers/essentia.worker.ts` on 2026-02-11.
- `public/madmom/*`
  Copied from `web/public/madmom/*` on 2026-02-11.
- `public/worker.js`
  Copied from `web/public/worker.js` on 2026-02-11.
- `public/icons/icon-192.png`, `public/icons/icon-512.png`
  Copied from `web/public/logo.png` on 2026-02-11.
- `public/fonts/tilt-neon.ttf`
  Copied from `android/app/src/main/res/font/tilt_neon_regular.ttf` on 2026-02-11.

## Deltas vs original

- The analysis pipeline runs in a dedicated worker (`src/workers/analysis.worker.ts`).
- No Spotify/YouTube/search/UI codepaths are present.
- Offline-only CSP is enforced.
- OPFS/IndexedDB caching is new.
- Export JSON includes metadata (createdAt, appVersion, fingerprint).
- The Listen screen uses local SVG control icons to avoid external icon font dependencies.

## Assumptions

- The madmom WASM worker and model files in `public/madmom/` are the same ones used by the browser analysis demo.
- The Android font file is acceptable for desktop PWA usage and bundling.
- Material Symbols web font is not vendored in-repo, so icon controls use local SVG glyphs.
- Audio decoding uses the Web Audio API and does not require additional codecs beyond the browser defaults.
