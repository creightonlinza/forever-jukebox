#!/usr/bin/env bash
set -euo pipefail

cd /app/api

python worker/worker.py &
worker_pid=$!

uvicorn api.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "*" &
api_pid=$!

# PO token provider for yt-dlp (auto-detected on 127.0.0.1:4416); auxiliary,
# so it is kept out of `wait -n` — losing it degrades yt-dlp to tokenless mode.
# Deferred until uvicorn has bound: on a Fly resume-from-stopped the rootfs is
# cold, and Deno's own cold-start reads (runtime + deno-dir cache + canvas
# native module) otherwise contend for disk I/O with uvicorn's imports, slowing
# the page-load path on every wake. POT is only needed for the first analysis,
# which is many seconds out, so gating it on readiness costs nothing. Falls
# through after ~30s so a stuck uvicorn can't strand the provider forever.
(
  for _ in $(seq 1 60); do
    (exec 3<>"/dev/tcp/127.0.0.1/${PORT:-8000}") 2>/dev/null && break
    sleep 0.5
  done
  cd /app/bgutil-pot/server/node_modules \
    && exec env DENO_DIR=/app/bgutil-pot/deno-dir \
         deno run --allow-env --allow-net --allow-ffi=. --allow-read=. ../src/main.ts
) &
pot_pid=$!

trap 'kill "$pot_pid" "$worker_pid" "$api_pid" 2>/dev/null || true' SIGTERM SIGINT

wait -n "$worker_pid" "$api_pid"
kill "$pot_pid" "$worker_pid" "$api_pid" 2>/dev/null || true
wait
