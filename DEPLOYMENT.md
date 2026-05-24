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
- Persist `api/storage/` with a volume (EBS/EFS on AWS); container storage is ephemeral.
- Dependency updates (`yt-dlp`, `madmom-beats-lite`, `deno`) happen during image build/deploy; container startup performs no network updates.
