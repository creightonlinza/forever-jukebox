# Deployment (Docker)

This setup builds the web UI, builds the offline PWA, and runs the API + worker in one container.

## Build

```bash
docker build -t forever-jukebox .
```

## Run

```bash
docker run \
  -p 80:8000 \
  -v $(pwd)/api/storage:/app/api/storage \
  -e SPOTIFY_CLIENT_ID=... \
  -e SPOTIFY_CLIENT_SECRET=... \
  forever-jukebox
```

Environment variables:

Use the same env vars documented in the canonical Docker section: [`README.md#docker-production`](./README.md#docker-production).

Example `.env` and run:

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

```bash
docker run \
  -p 80:8000 \
  -v $(pwd)/api/storage:/app/api/storage \
  --env-file .env \
  forever-jukebox
```

Notes:

- The API serves the web UI at `/`, the offline PWA at `/offline/`, and JSON at `/api/*`.
- Persist `api/storage/` with a local or block-backed volume; container storage is ephemeral.
- `WORKER_COUNT` can be raised for one app instance on a local/container volume; `6`
  is a reasonable modest-concurrency target. Use a real queue/database instead of
  SQLite for multiple app containers sharing job state, NFS-style shared filesystems,
  or high write concurrency.
- Do not delete `jobs.db-journal`, `jobs.db-wal`, or `jobs.db-shm` while the app is
  running. Stop the API and workers first so SQLite can finish recovery/checkpointing.
- Dependency updates (`yt-dlp`, `madmom-beats-lite`, `deno`) happen during image build/deploy; container startup performs no network updates.
- The container runs a [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
  server on `127.0.0.1:4416` so yt-dlp can fetch YouTube PO tokens without a browser;
  the yt-dlp plugin auto-detects it. The pip plugin pin in `api/requirements.txt` and
  `BGUTIL_POT_VERSION` in the `Dockerfile` must be bumped together. Local dev needs no
  setup (yt-dlp degrades gracefully without the server); to get tokens locally, run
  `docker run --rm -d -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider:1.3.1`.
