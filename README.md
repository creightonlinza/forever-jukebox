# The Forever Jukebox

![The Forever Jukebox logo](./tfj-logo.png)

The Forever Jukebox is a self-hosted, end-to-end system that analyzes audio,
serves the results via a lightweight API, and powers a refreshed Infinite
Jukebox-style web UI with branching playback and multiple visualizations. It
also includes an installable offline PWA.
It replaces reliance on the deprecated Spotify Audio Analysis engine by
generating similar beat/segment/section data locally.

## Structure

- `engine/` — The Forever Jukebox audio analysis engine.
- `api/` — REST API + worker that calls the engine.
- `web/` — Web UI.
- `pwa/` — Offline/local analysis PWA that can also export jukebox audio.
- `schema.json` — JSON schema reference for analysis output.

## Quick Start

Prereqs: Python 3.11, npm (Node.js), ffmpeg.

All-in-one local dev:

```bash
./dev.sh
```

Local dev startup installs missing dependencies by default and does not check for latest versions each run. To force dependency updates locally, temporarily enable the update toggles in `dev.sh` and rerun it.

Then open the web UI at `http://localhost:5173`.

## Android App (standalone repo)

- Source + releases: [creightonlinza/forever-jukebox-android](https://github.com/creightonlinza/forever-jukebox-android)

## Docker (production)

Build and run the container with Docker Compose (serves web UI + offline PWA + API).

Set environment variables:

Required:

- `SPOTIFY_CLIENT_ID`: required for `/api/search/spotify`.
- `SPOTIFY_CLIENT_SECRET`: required for `/api/search/spotify`.

Optional:

- `YOUTUBE_API_KEY`: optional fallback for `/api/search/youtube` when `yt-dlp` search fails.
- `ADMIN_KEY`: optional; required only for admin-only actions (play-count updates, and deletes outside the 30-minute grace window). Send it via `X-Admin-Key` request header.
- `NTFY_TOPIC_KEY`: optional; enables ntfy alerts for YouTube download errors.
- `WORKER_COUNT`: optional; defaults to `1` and controls worker concurrency.
- `MAX_TRACK_LENGTH`: optional; when set to a positive number (minutes), rejects jobs over that duration.
- `MAX_FAVORITES`: optional; defaults to `150` and controls the maximum favorites sync payload size.
- `ALLOW_USER_UPLOAD`: optional; defaults to `false`. Set `true` to enable `/api/upload`.
- `ALLOW_USER_URL`: optional; defaults to `false`. Set `true` to allow user-supplied URL jobs (YouTube, SoundCloud, Bandcamp).
- `ALLOW_FAVORITES_SYNC`: optional; defaults to `false`. Set `true` to enable favorites sync endpoints.
- `HOSTED_BY_NAME`: optional; shows an instance host credit in the web footer.
- `HOSTED_BY_URL`: optional; links the host credit when `HOSTED_BY_NAME` is set.
- `PORT`: optional; defaults to `8000`.

Example `.env`:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
YOUTUBE_API_KEY=
ADMIN_KEY=
NTFY_TOPIC_KEY=
WORKER_COUNT=1
MAX_TRACK_LENGTH=12
MAX_FAVORITES=
ALLOW_USER_UPLOAD=false
ALLOW_USER_URL=false
ALLOW_FAVORITES_SYNC=false
HOSTED_BY_NAME=
HOSTED_BY_URL=
PORT=8000
```

You can put these values in a `.env` file (same directory as `docker-compose.yml`) and Compose will load them automatically.

Run:

```bash
docker compose up --build
```

Notes:

- Dependency updates (`yt-dlp`, `madmom-beats-lite`, `deno`) happen at image build/deploy time. Container startup does not perform network updates.
- To force-refresh externally sourced dependencies, run `docker compose build --no-cache` and then `docker compose up`.

Open:

- Web UI: `http://localhost:8000/`
- Offline PWA: `http://localhost:8000/offline/`

API routes are under `/api/*`. The Compose file uses a named Docker volume
(`storage`) to persist `/app/api/storage`.

## Standalone Setup

- [`engine/README.md`](./engine/README.md)
- [`api/README.md`](./api/README.md)
- [`web/README.md`](./web/README.md)
- [`pwa/README.md`](./pwa/README.md)

## Credits

- The Infinite Jukebox (Paul Lamere): original interactive concept and UX inspiration.
- The Echo Nest / Spotify Audio Analysis: foundational analysis schema and ideas.
- EternalJukebox: keeping the dream alive.
- madmom-beats-lite: parity-safe beat/downbeat extraction package.
- Essentia: audio features and DSP toolkits.
- yt-dlp: YouTube search metadata and audio.
- OpenAI Codex (GPT-5): implementation guidance and tooling.
