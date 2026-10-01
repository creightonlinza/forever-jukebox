# Forever Jukebox Web UI (TypeScript)

## Run
```bash
npm install   # once, at the repo root (npm workspaces)
npm run dev
```

Lint:

```bash
npm run lint
```

## Tests

```bash
npm test              # unit tests (vitest)
npm run test:e2e      # full-app Playwright e2e (boots ../dev.sh if needed)
npm run test:e2e:ui   # interactive Playwright runner
```

The e2e suite drives the real UI against a real backend and discovers its
fixture tracks from `/api/top` at runtime, so the backend needs at least
three analyzed tracks (plus Spotify credentials for the search specs). See
[`e2e/README.md`](./e2e/README.md) for running against a deployed
environment and the opt-in YouTube ingest flow.

Audio is decoded into a single in-memory buffer before playback to avoid stalls on jumps,
and jumps are scheduled at beat boundaries.
Use the Tuning panel to adjust branching behavior.
The visualization stays hidden until both audio and analysis files are loaded.
Use the Visualization buttons (1–6) to switch layouts while audio continues.
Audio results are cached locally in IndexedDB when available; browsers may evict cached
data under storage pressure.

## Extras audio modes
- Available modes: `off`, `nightcore`, `daycore`, `vaporwave`, `eight_d`, `eight_bit`, `lofi`, `underwater`, `cathedral`, `cowbell`, `swing`, `instrumental`.
- UI labels/tooltips:
  - Normal
  - Nightcore (Fast & Bright)
  - Daycore (Slow & Deep)
  - Vaporwave (Muffled & Slow)
  - 8D Audio (Spinning/Spatial)
  - 8-Bit (Bitcrushed & Filtered)
  - Lofi (Radio Filter)
  - Underwater (Heavy Low-Pass)
  - Cathedral (Cathedral Reverb)
  - More Cowbell
  - Swing (pre-renders a pitch-preserved swung buffer with Rubber Band WASM)
  - Instrumental (pre-renders a vocals-removed buffer; see below)
- More Cowbell and Swing are beat-aware remix toys inspired by Echo Nest Remix:
  https://github.com/echonest/remix
- Shared listen URLs can include `am=<mode>` (for example `am=nightcore`).

### Instrumental mode
`instrumental` removes vocals in the browser with the UVR MDX-Net Inst HQ 3 model on ONNX
Runtime Web. The pipeline lives in `packages/shared/src/audio/instrumental*.ts` and is
shared with the PWA.

- Desktop browsers with WebGPU only. It is hidden on phones and tablets, where the model
  exhausts memory, and without WebGPU, where it takes several times the track's length.
- The worker and runtime load when the mode is selected. The model (67 MB) downloads from
  Hugging Face on first use and is kept in Cache Storage (`fj-instrumental-models`).
- Rendered instrumentals are kept in Cache Storage (`fj-instrumental-tracks`) so a track
  is only separated once, as WebM/Opus at 160 kbps where the browser's WebCodecs encoder
  supports it and otherwise as 16-bit PCM. Entries are decoded with `decodeAudioData`,
  the same path as streamed tracks. A stored instrumental counts as part of its track
  in the audio cache: toward the size in Settings and the 500 MB cap, and it is removed
  with the track's cached audio, including on eviction.
- A failed render shows a toast and returns to Normal mode.

## Keyboard shortcuts
- Space: play/pause while on the Listen tab.
- E: open the Extras options modal tab.
- Shift (hold): force branches while the jukebox is playing.
- H: toggle Bring It Home mode.
- Left/Right: cycle selected branch.
- A: set/reset the selected backward branch as the anchor branch.
- Delete: remove a selected branch (click a branch in the visualization first).

## Analysis format (inferred)
This app expects a JSON object with top-level arrays matching the analysis schema:

```json
{
  "sections": [{ "start": 0.0, "duration": 5.0, "confidence": 0.7 }],
  "bars": [{ "start": 0.0, "duration": 2.0, "confidence": 0.6 }],
  "beats": [{ "start": 0.0, "duration": 0.5, "confidence": 0.5 }],
  "tatums": [{ "start": 0.0, "duration": 0.25, "confidence": 0.4 }],
  "segments": [{
    "start": 0.0,
    "duration": 0.4,
    "confidence": 0.3,
    "loudness_start": -20,
    "loudness_max": -6,
    "loudness_max_time": 0.2,
    "pitches": [0.1, 0.2, ... 12 values ...],
    "timbre": [1.0, 2.0, ... 12 values ...]
  }],
  "track": { "duration": 123.4, "tempo": 120.0, "time_signature": 4 }
}
```

If the analysis file nests these arrays under `analysis`, that is also supported.

This UI calls the API via the `/api` prefix (proxied by Vite).
See `schema.json` at the repo root for the full analysis schema reference.

## Admin mode

Set the API `ADMIN_KEY` value in browser local storage under `fj-admin-key` to keep
track deletion available outside the normal 30-minute grace window. Admin delete
requests send the value in the `X-Admin-Key` header. Reload the page or load another
track after changing the value. Because the key is stored in browser local storage,
use admin mode only on trusted instances and devices.

## Jump logic (high level)
- Beats are the main playback unit.
- Each beat builds a list of candidate "neighbors" by comparing overlapping segments.
- The engine ramps a branching probability between a min/max range.
- On each beat boundary, the engine either:
  - plays the next beat linearly, or
  - jumps to a neighbor beat (branch), then continues from there.
- A "last branch point" is computed to avoid dead-ends; that beat always branches.

## Core components
- `packages/shared/src/engine/analysis.ts` preprocesses quanta + overlapping segments.
- `packages/shared/src/engine/graph.ts` builds the jump graph and branch thresholds.
- `packages/shared/src/engine/JukeboxEngine.ts` runs playback + random branching.
- `packages/shared/src/audio/BufferedAudioPlayer.ts` buffers audio and handles jumps.
