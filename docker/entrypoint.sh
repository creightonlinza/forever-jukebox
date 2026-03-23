#!/usr/bin/env bash
set -euo pipefail

cd /app/api

python worker/worker.py &
worker_pid=$!

uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}" &
api_pid=$!

trap 'kill "$worker_pid" "$api_pid" 2>/dev/null || true' SIGTERM SIGINT

wait -n "$worker_pid" "$api_pid"
kill "$worker_pid" "$api_pid" 2>/dev/null || true
wait
