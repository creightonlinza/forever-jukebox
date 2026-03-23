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
  -e YOUTUBE_API_KEY=... \
  -e ADMIN_KEY=... \
  -e NTFY_TOPIC_KEY=... \
  -e MAX_TRACK_LENGTH=12 \
  -e ALLOW_USER_UPLOAD=false \
  -e ALLOW_USER_YOUTUBE=false \
  forever-jukebox
```

Notes:

- The API serves the web UI at `/`, the offline PWA at `/offline/`, and JSON at `/api/*`.
- Persist `api/storage/` with a volume (EBS/EFS on AWS); container storage is ephemeral.
- Dependency updates (`yt-dlp`, `madmom-beats-lite`, `deno`) happen during image build/deploy; container startup performs no network updates.
- Optional: set `PORT` to change the internal listen port (defaults to 8000).
- Optional: set `WORKER_COUNT` (default `1`) to control worker concurrency.
- Optional: set `MAX_TRACK_LENGTH` (minutes) to reject user-upload and YouTube jobs above that duration.
- `ADMIN_KEY` is optional unless you need admin-only endpoints (delete outside 30 minutes, play count adjustments).
- `ALLOW_USER_UPLOAD` and `ALLOW_USER_YOUTUBE` default to false; set them to `true` to enable user uploads or user-supplied YouTube jobs.
