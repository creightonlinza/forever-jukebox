# Forever Jukebox PWA

Standalone, offline PWA for local audio analysis and playback.

- Runs analysis entirely in-browser (no backend calls).
- Uses dedicated workers for beat/downbeat detection and feature extraction.
- Supports installable desktop PWA behavior.

## Quick start

```bash
cd pwa
npm install
npm run dev
```

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build
npm run preview  # preview production build
npm run lint     # eslint checks
npm run test     # unit tests
```

## Install as desktop app

1. Open in Chrome or Edge.
2. Click the browser install icon or the in-app install button.
3. Launch from your OS app list/dock.

## Offline behavior

- App shell/assets are precached with Workbox (`vite-plugin-pwa`).
- Once cached, navigation and static assets load offline.
- CSP and runtime behavior restrict the app to self-origin resources.

## Analysis pipeline

- Worker orchestration: `src/workers/analysis.worker.ts`
- Beat/downbeat model worker: `public/madmom/worker.js`
- Feature/segmentation worker: `src/workers/essentia.worker.ts`
- Audio decode/resample for analysis: `ffmpeg.wasm` (mono PCM at 22.05kHz + 44.1kHz)
- Playback buffer decode: Web Audio API (`decodeAudioData`) from ffmpeg-generated WAV
- madmom worker consumes backend-parity arrays (`beat_times`, `beat_numbers`, `beat_confidences`)
- madmom WASM package/models are from `madmom-beats-port v4.0.0`

madmom WASM: [madmom-beats-port](https://github.com/creightonlinza/madmom-beats-port)

## Storage and cache

- Analysis cache key: fingerprint (`name + size + lastModified + first-bytes hash`)
- Backends: OPFS when available, otherwise IndexedDB
- Cache controls and usage are available in the FAQ screen

## Jukebox audio export

- Export playable jukebox output directly from the Listen screen.
- Export uses current tuning + deleted branches and a fresh seeded random run.
- Formats:
  - MP3 (compressed)
  - WAV (lossless)
- Max export length: 7200 seconds (2 hours).
- Long MP3 exports are rendered/encoded in chunks to avoid browser memory spikes.
- Very long WAV exports can still hit browser memory limits; use MP3 for long durations.
