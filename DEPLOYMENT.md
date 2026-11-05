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
- `yt-dlp` tracks the nightly channel, so the image carries whichever nightly was current when the
  pip layer was built. That layer is keyed on `api/requirements.txt`, which does not change between
  nightlies, so use `fly deploy --no-cache` (or `docker build --no-cache`) to pull a newer one.
- The container runs a [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
  server on `127.0.0.1:4416` so yt-dlp can fetch YouTube PO tokens without a browser;
  the yt-dlp plugin auto-detects it. The pip plugin pin in `api/requirements.txt` and
  `BGUTIL_POT_VERSION` in the `Dockerfile` must be bumped together. Local dev needs no
  setup (yt-dlp degrades gracefully without the server); to get tokens locally, run
  `docker run --rm -d -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider:2.0.0`.

## Optional: Tigris object storage

By default audio and analysis live under `api/storage/` next to the SQLite databases and
logs. On Fly.io they can live in a private [Tigris](https://fly.io/docs/tigris/) bucket
instead, so the volume only holds the databases and logs. Nothing changes unless
`STORAGE_BACKEND=tigris` is set.

1. Create a bucket: `fly storage create -a <app> -n <bucket>`. This sets `BUCKET_NAME`,
   `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as app
   secrets; they are ignored until `STORAGE_BACKEND=tigris` is set. Leave Tigris snapshots
   off: deletes are plain deletes and only free space on an unversioned bucket.
2. Allow browsers to read presigned audio URLs (the web player fetches `/api/audio/{id}`,
   which redirects to the bucket):

   ```bash
   aws s3api put-bucket-cors --endpoint-url "$AWS_ENDPOINT_URL_S3" --bucket "$BUCKET_NAME" \
     --cors-configuration '{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]}'
   ```

3. Copy existing files with the app's credentials, from `/app/api` on the machine:
   `python scripts/sync_storage_to_tigris.py push`, then `... verify`. Re-running `push`
   uploads only new files; `prune --apply` removes objects for jobs deleted since an earlier
   push, and `verify --repair` re-uploads anything missing or mismatched.
4. Set `STORAGE_BACKEND=tigris` (`fly secrets set STORAGE_BACKEND=tigris`).
5. Once the app runs on the bucket and `verify` is clean, the local copies under
   `api/storage/audio/` and `api/storage/analysis/` are unused. Delete them, or move the
   databases and `logs/` to a new, smaller volume, to reclaim the space.

With Tigris enabled, `/api/audio/{id}` answers with a 307 redirect to a 10-minute presigned
URL, analysis is still returned inline by `/api/analysis/{id}`, and downloads in progress
use a scratch directory on the machine's own disk. To move back to local storage, run
`sync_storage_to_tigris.py pull` and unset `STORAGE_BACKEND`.
