#!/usr/bin/env bash
set -euo pipefail

cd /app/api

# PO token provider for yt-dlp (auto-detected on 127.0.0.1:4416); auxiliary,
# so it is kept out of `wait -n` — losing it degrades yt-dlp to tokenless mode
(cd /app/bgutil-pot/server/node_modules \
  && exec env DENO_DIR=/app/bgutil-pot/deno-dir \
       deno run --allow-env --allow-net --allow-ffi=. --allow-read=. ../src/main.ts) &
pot_pid=$!

python worker/worker.py &
worker_pid=$!

uvicorn api.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "*" &
api_pid=$!

trap 'kill "$pot_pid" "$worker_pid" "$api_pid" 2>/dev/null || true' SIGTERM SIGINT

wait -n "$worker_pid" "$api_pid"
kill "$pot_pid" "$worker_pid" "$api_pid" 2>/dev/null || true
wait
