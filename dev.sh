#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_VENV="$ROOT/api/.venv"
ENGINE_VENV="$ROOT/engine/.venv"
WEB_DIR="$ROOT/web"
VITE_HOST_FLAG=""
PYTHON_BIN=""
PYTHON_VERSION=""
# Local dev startup dependency refresh toggles.
# Edit these values in this script when you want startup upgrade checks.
UPDATE_YTDLP=false
UPDATE_DENO=false
UPDATE_MADMOM_BEATS_LITE=false

for arg in "$@"; do
  if [[ "$arg" == "--host" ]]; then
    VITE_HOST_FLAG="VITE_LAN=1"
  fi
done

if [[ "${1:-}" == "--clean" ]]; then
  echo "Cleaning local storage..."
  running_pids=()
  while IFS= read -r pid; do
    running_pids+=("$pid")
  done < <(pgrep -f "worker/worker.py" || true)
  while IFS= read -r pid; do
    running_pids+=("$pid")
  done < <(pgrep -f "uvicorn api.main:app" || true)
  if [[ "${#running_pids[@]}" -gt 0 ]]; then
    echo "Stopping running dev processes..."
    pkill -f "worker/worker.py" || true
    pkill -f "uvicorn api.main:app" || true
    for _ in {1..10}; do
      if pgrep -f "worker/worker.py" >/dev/null 2>&1; then
        sleep 0.2
        continue
      fi
      if pgrep -f "uvicorn api.main:app" >/dev/null 2>&1; then
        sleep 0.2
        continue
      fi
      break
    done
    if pgrep -f "worker/worker.py" >/dev/null 2>&1; then
      pkill -9 -f "worker/worker.py" || true
    fi
    if pgrep -f "uvicorn api.main:app" >/dev/null 2>&1; then
      pkill -9 -f "uvicorn api.main:app" || true
    fi
  fi
  rm -rf "$ROOT/api/storage/audio" "$ROOT/api/storage/analysis" "$ROOT/api/storage/logs" "$ROOT/api/storage/jobs.db" "$ROOT/api/storage/favorites.db"
  mkdir -p "$ROOT/api/storage/audio" "$ROOT/api/storage/analysis" "$ROOT/api/storage/logs"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
from pathlib import Path
import sys

root = Path("${ROOT}")
sys.path.insert(0, str(root / "api"))
from api.db import init_db
from api.favorites_db import init_favorites_db

init_db(root / "api" / "storage" / "jobs.db")
init_favorites_db(root / "api" / "storage" / "favorites.db")
PY
    echo "Recreated job schema."
    echo "Recreated favorites schema."
  else
    echo "Warning: python3 not found; jobs.db schema not recreated."
  fi
  echo "Done."
  exit 0
fi

ensure_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

is_true() {
  local value="${1:-}"
  value="$(echo "$value" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "true" ]]
}

resolve_python() {
  if [[ -n "${FJ_PYTHON:-}" ]]; then
    if [[ -x "$FJ_PYTHON" ]]; then
      PYTHON_BIN="$FJ_PYTHON"
      return
    fi
    echo "FJ_PYTHON is set but not executable: $FJ_PYTHON"
    exit 1
  fi
  for candidate in python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$(command -v "$candidate")"
      return
    fi
  done
  echo "Missing required command: python3"
  exit 1
}

resolve_python_version() {
  PYTHON_VERSION="$("$PYTHON_BIN" - <<'PY'
import sys
print(f"{sys.version_info[0]}.{sys.version_info[1]}")
PY
)"
}

ensure_python() {
  resolve_python
  resolve_python_version
  if [[ -z "$PYTHON_BIN" ]]; then
    echo "Missing required command: python3"
    exit 1
  fi
  if [[ "$PYTHON_VERSION" != "3.11" ]]; then
    echo "Python 3.11 is required for local dev (detected: $PYTHON_VERSION)."
    echo "Install python3.11 or set FJ_PYTHON to a Python 3.11 executable."
    exit 1
  fi
}

venv_version() {
  local venv_python="$1"
  "$venv_python" - <<'PY'
import sys
print(f"{sys.version_info[0]}.{sys.version_info[1]}")
PY
}

ensure_venv() {
  local venv_path="$1"
  if [[ ! -d "$venv_path" ]]; then
    "$PYTHON_BIN" -m venv "$venv_path"
    return
  fi
  if [[ ! -x "$venv_path/bin/python" ]] || ! "$venv_path/bin/python" -c "import sys" >/dev/null 2>&1; then
    echo "Recreating venv at $venv_path (stale or moved)."
    rm -rf "$venv_path"
    "$PYTHON_BIN" -m venv "$venv_path"
    return
  fi
  local current_version
  current_version="$(venv_version "$venv_path/bin/python")"
  if [[ "$current_version" != "$PYTHON_VERSION" ]]; then
    echo "Recreating venv at $venv_path (Python $current_version != $PYTHON_VERSION)."
    rm -rf "$venv_path"
    "$PYTHON_BIN" -m venv "$venv_path"
  fi
}

try_deno_upgrade_with_package_manager() {
  if command -v brew >/dev/null 2>&1; then
    if brew list --versions deno >/dev/null 2>&1; then
      echo "Trying Homebrew upgrade for deno..."
      if brew upgrade deno; then
        return 0
      fi
    fi
  fi

  if command -v scoop >/dev/null 2>&1; then
    if scoop list deno >/dev/null 2>&1; then
      echo "Trying Scoop upgrade for deno..."
      if scoop update deno; then
        return 0
      fi
    fi
  fi

  if command -v choco >/dev/null 2>&1; then
    if choco list --local-only deno >/dev/null 2>&1; then
      echo "Trying Chocolatey upgrade for deno..."
      if choco upgrade -y deno; then
        return 0
      fi
    fi
  fi

  if command -v winget >/dev/null 2>&1; then
    echo "Trying winget upgrade for deno..."
    if winget upgrade --id DenoLand.Deno --accept-package-agreements --accept-source-agreements; then
      return 0
    fi
  fi

  return 1
}

try_deno_install_with_package_manager() {
  if command -v brew >/dev/null 2>&1; then
    echo "Trying Homebrew install for deno..."
    if brew install deno; then
      return 0
    fi
  fi

  if command -v scoop >/dev/null 2>&1; then
    echo "Trying Scoop install for deno..."
    if scoop install deno; then
      return 0
    fi
  fi

  if command -v choco >/dev/null 2>&1; then
    echo "Trying Chocolatey install for deno..."
    if choco install -y deno; then
      return 0
    fi
  fi

  if command -v winget >/dev/null 2>&1; then
    echo "Trying winget install for deno..."
    if winget install --id DenoLand.Deno --accept-package-agreements --accept-source-agreements; then
      return 0
    fi
  fi

  return 1
}

print_deno_upgrade_hint() {
  echo "Warning: could not auto-upgrade deno."
  if command -v brew >/dev/null 2>&1; then
    echo "Hint: if deno was installed with Homebrew, run: brew upgrade deno"
  elif command -v scoop >/dev/null 2>&1; then
    echo "Hint: if deno was installed with Scoop, run: scoop update deno"
  elif command -v choco >/dev/null 2>&1; then
    echo "Hint: if deno was installed with Chocolatey, run: choco upgrade -y deno"
  elif command -v winget >/dev/null 2>&1; then
    echo "Hint: if deno was installed with winget, run: winget upgrade --id DenoLand.Deno"
  elif command -v apt-get >/dev/null 2>&1; then
    echo "Hint: if deno was installed from apt, run: sudo apt-get install --only-upgrade deno"
  elif command -v dnf >/dev/null 2>&1; then
    echo "Hint: if deno was installed from dnf, run: sudo dnf upgrade deno"
  elif command -v pacman >/dev/null 2>&1; then
    echo "Hint: if deno was installed from pacman, run: sudo pacman -Syu deno"
  elif command -v zypper >/dev/null 2>&1; then
    echo "Hint: if deno was installed from zypper, run: sudo zypper update deno"
  elif command -v nix >/dev/null 2>&1; then
    echo "Hint: if deno was installed with nix, run: nix profile upgrade deno"
  else
    echo "Hint: upgrade deno using the same method you used to install it."
  fi
}

print_deno_install_hint() {
  echo "Warning: deno not found and could not be auto-installed."
  if command -v brew >/dev/null 2>&1; then
    echo "Hint: install deno with Homebrew: brew install deno"
  elif command -v scoop >/dev/null 2>&1; then
    echo "Hint: install deno with Scoop: scoop install deno"
  elif command -v choco >/dev/null 2>&1; then
    echo "Hint: install deno with Chocolatey: choco install -y deno"
  elif command -v winget >/dev/null 2>&1; then
    echo "Hint: install deno with winget: winget install --id DenoLand.Deno"
  else
    echo "Hint: install deno using your OS package manager or https://deno.land/manual/getting_started/installation"
  fi
}

ensure_api_env() {
  ensure_venv "$API_VENV"
  if ! "$API_VENV/bin/python" -c "import fastapi, yt_dlp, httpx, dotenv" >/dev/null 2>&1; then
    "$API_VENV/bin/python" -m pip install -r "$ROOT/api/requirements.txt"
  fi
  if is_true "$UPDATE_YTDLP"; then
    if ! "$API_VENV/bin/python" -m pip install --upgrade "yt-dlp[default]"; then
      echo "Warning: could not auto-upgrade yt-dlp; continuing with installed version."
    fi
  fi
  if ! command -v deno >/dev/null 2>&1; then
    if ! try_deno_install_with_package_manager; then
      print_deno_install_hint
    fi
  fi
  if is_true "$UPDATE_DENO" && command -v deno >/dev/null 2>&1; then
    if ! deno upgrade; then
      if ! try_deno_upgrade_with_package_manager; then
        print_deno_upgrade_hint
      fi
    fi
  fi
  if ! command -v deno >/dev/null 2>&1; then
    echo "Warning: deno not found in PATH (yt-dlp EJS may fail)."
  fi
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "Warning: ffmpeg not found in PATH (audio decoding may fail)."
  fi
}

ensure_engine_env() {
  ensure_venv "$ENGINE_VENV"
  if ! "$ENGINE_VENV/bin/python" -c "import pkg_resources" >/dev/null 2>&1; then
    "$ENGINE_VENV/bin/python" -m pip install setuptools
  fi
  if ! "$ENGINE_VENV/bin/python" -c "import numpy, scipy, essentia, packaging" >/dev/null 2>&1; then
    "$ENGINE_VENV/bin/python" -m pip install -r "$ROOT/engine/requirements.txt"
  fi
  local has_madmom_beats_lite=0
  if "$ENGINE_VENV/bin/python" -c "import madmom_beats_lite" >/dev/null 2>&1; then
    has_madmom_beats_lite=1
  fi
  if is_true "$UPDATE_MADMOM_BEATS_LITE" || [[ "$has_madmom_beats_lite" == "0" ]]; then
    if ! "$ENGINE_VENV/bin/python" "$ROOT/engine/scripts/install_madmom_beats_lite.py" --python "$ENGINE_VENV/bin/python"; then
      if [[ "$has_madmom_beats_lite" == "1" ]]; then
        echo "Warning: could not auto-update madmom-beats-lite; continuing with installed version."
      else
        echo "Error: madmom-beats-lite installation failed."
        exit 1
      fi
    fi
  fi
  if "$ENGINE_VENV/bin/python" -m pip show madmom >/dev/null 2>&1; then
    "$ENGINE_VENV/bin/python" -m pip uninstall -y madmom
    if ! "$ENGINE_VENV/bin/python" "$ROOT/engine/scripts/install_madmom_beats_lite.py" --python "$ENGINE_VENV/bin/python"; then
      echo "Error: madmom-beats-lite reinstall failed after removing legacy madmom."
      exit 1
    fi
  fi
}

ensure_web_deps() {
  if [[ ! -d "$WEB_DIR/node_modules" ]]; then
    (cd "$WEB_DIR" && npm install)
  fi
}

export ENGINE_REPO="$ROOT/engine"
# export ENGINE_CONFIG="$ROOT/engine/calibration.json"

pids=()

run_prefixed() {
  local name="$1"
  shift
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL "$@" 2>&1 | sed -e "s/^/[$name] /"
  else
    "$@" 2>&1 | sed -e "s/^/[$name] /"
  fi
}

start_api() {
  (
    cd "$ROOT/api"
    run_prefixed "api" "$API_VENV/bin/python" -m uvicorn api.main:app --host 0.0.0.0 --port 8000
  ) &
  pids+=("$!")
}

start_worker() {
  (
    cd "$ROOT/api"
    export PYTHONPATH="$ROOT/api"
    run_prefixed "worker" "$ENGINE_VENV/bin/python" worker/worker.py
  ) &
  pids+=("$!")
}

start_web() {
  (
    cd "$ROOT/web"
    if [[ -n "$VITE_HOST_FLAG" ]]; then
      VITE_LAN=1 run_prefixed "web" npm run dev -- --host
    else
      run_prefixed "web" npm run dev
    fi
  ) &
  pids+=("$!")
}

cleanup() {
  echo "Shutting down..."
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
    kill -- "-$pid" 2>/dev/null || true
  done
  pkill -f "worker/worker.py" 2>/dev/null || true
  pkill -f "uvicorn api.main:app" 2>/dev/null || true
  wait
}

trap cleanup INT TERM EXIT

ensure_python
ensure_command npm
ensure_api_env
ensure_engine_env
ensure_web_deps

start_api
start_worker
start_web

echo "API: http://localhost:8000"
echo "Web: http://localhost:5173"
wait
