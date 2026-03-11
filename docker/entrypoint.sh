#!/usr/bin/env bash
set -euo pipefail

retry() {
  local attempts="$1"
  shift
  local delay="$1"
  shift
  local i=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [[ "$i" -ge "$attempts" ]]; then
      return 1
    fi
    i=$((i + 1))
    sleep "$delay"
  done
}

if [[ "${AUTO_UPDATE_YTDLP:-1}" == "1" ]]; then
  echo "Updating yt-dlp..."
  retry 3 2 /opt/venv/bin/python -m pip install --upgrade --no-cache-dir "yt-dlp[default]"
fi

if [[ "${AUTO_UPDATE_DENO:-1}" == "1" ]]; then
  echo "Updating Deno..."
  retry 3 2 deno upgrade
fi

cd /app/api

python worker/worker.py &
worker_pid=$!

uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}" &
api_pid=$!

trap 'kill "$worker_pid" "$api_pid" 2>/dev/null || true' SIGTERM SIGINT

wait -n "$worker_pid" "$api_pid"
kill "$worker_pid" "$api_pid" 2>/dev/null || true
wait
