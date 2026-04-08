# The Forever Jukebox Analysis API

REST API wrapper for the analysis generator. This codebase is intentionally separate from the analysis engine in `engine/`.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Linting (ruff):

```bash
pip install -r requirements-dev.txt
ruff check api worker
```

## Configure the generator

Set environment variables:

Required:

- `ENGINE_REPO` (example: `../engine`)

Optional:

- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
- `YOUTUBE_API_KEY`
- `ADMIN_KEY`
- `NTFY_TOPIC_KEY`
- `WORKER_COUNT`
- `MAX_TRACK_LENGTH`
- `ALLOW_USER_UPLOAD`
- `ALLOW_USER_URL`
- `ALLOW_FAVORITES_SYNC`

For defaults and behavior details, see the canonical Docker env reference in the root README: [`../README.md#docker-production`](../README.md#docker-production).

Example shell exports:

```bash
export ENGINE_REPO=../engine
# Optional:
# export SPOTIFY_CLIENT_ID=...
# export SPOTIFY_CLIENT_SECRET=...
# export YOUTUBE_API_KEY=
# export ADMIN_KEY=
# export NTFY_TOPIC_KEY=
export WORKER_COUNT=1
# export MAX_TRACK_LENGTH=12
# export ALLOW_USER_UPLOAD=true
# export ALLOW_USER_URL=true
# export ALLOW_FAVORITES_SYNC=true
```

## yt-dlp EJS runtime

yt-dlp requires a JS runtime to solve YouTube challenges. We use Deno and
configure EJS scripts in code. In Docker deploys, dependency refresh
(`yt-dlp`, `madmom-beats-lite`, `deno`) happens at image build/deploy time,
not on regular container startup.

## Run the API

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## Run the worker

```bash
python worker/worker.py
```

## Usage

Poll for analysis:

```bash
curl /api/analysis/<id>
```

Responses:

- `202` for `downloading`, `queued`, or `processing` (includes `progress`)
- `200` with `complete` + `result` JSON
- `200` with `failed` + `error` (failed jobs are retained with logs for inspection/repair)

Search Spotify:

```bash
curl "/api/search/spotify?q=daft%20punk"
```

Search YouTube (closest matches by duration):

```bash
curl "/api/search/youtube?q=daft%20punk&target_duration=210"
```

Create analysis from YouTube ID:

```bash
curl -X POST "/api/analysis/youtube" -H "Content-Type: application/json" -d '{"youtube_id":"dQw4w9WgXcQ"}'
```

Create analysis from URL (requires `ALLOW_USER_URL=true` for user-supplied jobs; supported domains: YouTube, SoundCloud, Bandcamp):

```bash
curl -X POST "/api/analysis/url" -H "Content-Type: application/json" -d '{"url":"https://soundcloud.com/artist/track"}'
```

Upload audio (requires `ALLOW_USER_UPLOAD=true`, max 20MB, m4a/webm/mp3/wav/flac/ogg/aac; also limited by optional `MAX_TRACK_LENGTH`):

```bash
curl -X POST "/api/upload" -F "file=@/path/to/audio.m4a"
```

Get app configuration flags:

```bash
curl "/api/app-config"
```

Response fields include `allow_user_upload`, `allow_user_url`, `max_upload_size` (bytes, only when uploads enabled), `allowed_upload_exts` (only when uploads enabled), and optional `max_track_length` (minutes).

Fetch audio for a job:

```bash
curl "/api/audio/<id>"
```


Lookup by source ID:

```bash
curl "/api/jobs/by-source/soundcloud/12345"
```

Increment play count:

```bash
curl -X POST "/api/plays/<id>"
```

Set play count (admin):

```bash
curl -X PATCH "/api/plays/<id>" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -d '{"play_count":123}'
```

Fetch top songs (defaults to 10):

```bash
curl "/api/top?limit=10"
```

Fetch trending songs (defaults: limit 25, past 5 days, excluding all-time top 25):

```bash
curl "/api/trending"
```

Fetch trending songs with explicit limit:

```bash
curl "/api/trending?limit=25"
```

Fetch recently played songs (defaults to 10):

```bash
curl "/api/recent?limit=10"
```

Create a favorites sync code:

```bash
curl -X POST "/api/favorites/sync" -H "Content-Type: application/json" -d '{"favorites":[{"uniqueSongId":"youtube:dQw4w9WgXcQ","title":"Never Gonna Give You Up","artist":"Rick Astley","duration":213,"sourceType":"youtube"}]}'
```

Update favorites for an existing sync code:

```bash
curl -X PUT "/api/favorites/sync/bison-laser-sunset" -H "Content-Type: application/json" -d '{"favorites":[{"uniqueSongId":"youtube:dQw4w9WgXcQ","title":"Never Gonna Give You Up","artist":"Rick Astley","duration":213,"sourceType":"youtube"}]}'
```

Fetch favorites by sync code:

```bash
curl "/api/favorites/sync/bison-laser-sunset"
```

Delete a job and its stored files:

```bash
curl -X DELETE "/api/jobs/<id>" -H "X-Admin-Key: $ADMIN_KEY"
```

Within 30 minutes of creation/completion, the admin header is not required:

```bash
curl -X DELETE "/api/jobs/<id>"
```

## Storage

Jobs and analysis outputs are stored under `storage/` in this repo:

- `storage/audio/`
- `storage/analysis/`
- `storage/logs/` - failure logs (engine output or download errors)
- `storage/jobs.db`
- `storage/favorites.db`
