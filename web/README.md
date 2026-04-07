# The Forever Jukebox Web UI (TypeScript)

## Run
```bash
npm install
npm run dev
```

Lint:

```bash
npm run lint
```

Audio is decoded into a single in-memory buffer before playback to avoid stalls on jumps,
and jumps are scheduled at beat boundaries.
Use the Tuning panel to adjust branching behavior.
The visualization stays hidden until both audio and analysis files are loaded.
Use the Visualization buttons (1–6) to switch layouts while audio continues.
Audio results are cached locally in IndexedDB when available; browsers may evict cached
data under storage pressure.

## Keyboard shortcuts
- Space: play/pause while on the Listen tab.
- Shift (hold): force branches while the jukebox is playing.
- H: toggle Bring It Home mode.
- E: toggle Extras mode (branch stats popup on branch tap).
- Left/Right: cycle selected branch.
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

## Jump logic (high level)
- Beats are the main playback unit.
- Each beat builds a list of candidate "neighbors" by comparing overlapping segments.
- The engine ramps a branching probability between a min/max range.
- On each beat boundary, the engine either:
  - plays the next beat linearly, or
  - jumps to a neighbor beat (branch), then continues from there.
- A "last branch point" is computed to avoid dead-ends; that beat always branches.

## Core components
- `web/src/engine/analysis.ts` preprocesses quanta + overlapping segments.
- `web/src/engine/graph.ts` builds the jump graph and branch thresholds.
- `web/src/engine/JukeboxEngine.ts` runs playback + random branching.
- `web/src/audio/BufferedAudioPlayer.ts` buffers audio and handles jumps.
