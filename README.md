# The Forever Jukebox

![The Forever Jukebox logo](./tfj-logo.png)

The Forever Jukebox is a self-hosted, end-to-end system that analyzes audio,
serves the results via a lightweight API, and powers a refreshed Infinite
Jukebox-style web UI with branching playback and multiple visualizations. It
also includes an installable offline PWA and a native Android app for on-device
playback. It replaces reliance on the deprecated Spotify Audio Analysis engine
by generating similar beat/segment/section data locally.

## Credits

- The Echo Nest / Spotify Audio Analysis: foundational analysis schema and ideas.
- The Infinite Jukebox (Paul Lamere): original interactive concept and UX inspiration.
- EternalJukebox: continued inspiration for infinite playback experiences.
- madmom: beat/downbeat tracking models and utilities.
- Essentia: audio features and DSP toolkits.
- Remixatron: beat-aligned segmentation concepts and madmom usage.
- numpy, scipy: DSP and math.
- ffmpeg: audio decoding.
- yt-dlp: YouTube search metadata and audio.
- OpenAI Codex (GPT-5): implementation guidance and tooling.

## Structure

- `engine/` — The Forever Jukebox Audio Analysis (generator + calibration bundle).
- `api/` — REST API + worker that calls the engine.
- `web/` — Web UI (see `web/README.md` for details).
- `pwa/` — Offline/local analysis PWA. Co-hosted in production at `/offline/`.
- `android/` — Native Android app (see `android/README.md` for details).
- `schema.json` — JSON schema reference for analysis output.

## Quick Start

Prereqs: Python 3, npm (Node.js).

All-in-one (dev):

```bash
./dev.sh
```

Then open the web UI at `http://localhost:5173`.

Android (native app):

- [`Debug Release APK`](https://github.com/creightonlinza/forever-jukebox/releases/tag/android-debug-latest)
- Must be pointed toward a running API and worker
- Full source available in `android/`

## Docker (production)

Build and run the container with Docker Compose (serves web UI + offline PWA + API):

```bash
export SPOTIFY_CLIENT_ID=...
export SPOTIFY_CLIENT_SECRET=...
export YOUTUBE_API_KEY=...
export ADMIN_KEY=...
export NTFY_TOPIC_KEY=...
export WORKER_COUNT=1
export ALLOW_USER_UPLOAD=false
export ALLOW_USER_YOUTUBE=false
export ALLOW_FAVORITES_SYNC=false
docker compose up --build
```

`ENGINE_CONFIG` is optional; set it only if you want a calibration bundle.

You can also put these values in a `.env` file (same directory as
`docker-compose.yml`) and Compose will load them automatically.

Open:

- Web UI: `http://localhost:8000/`
- Offline PWA: `http://localhost:8000/offline/`

API routes are under `/api/*`. The Compose file uses a named Docker volume
(`storage`) to persist `/app/api/storage`.

For standalone setup, see:

- [`engine/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/engine/README.md)
- [`api/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/api/README.md)
- [`web/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/web/README.md)
- [`pwa/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/pwa/README.md)
- [`android/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/android/README.md)
