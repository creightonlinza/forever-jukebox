"""Background worker that runs analysis jobs."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import multiprocessing
from datetime import datetime, timezone
from pathlib import Path

from api.db import (
    claim_next_job,
    init_db,
    recover_stalled_processing_jobs,
    set_job_progress,
    set_job_status,
)
from api.routes.jobs_runtime import failure_code_for, log_event
from api.utils import abs_storage_path, get_logger

APP_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = (APP_ROOT / "storage").resolve()
DB_PATH = STORAGE_ROOT / "jobs.db"

ENGINE_REPO = Path(os.environ.get("ENGINE_REPO", ""))


def _env_int(key: str, default: int) -> int:
    value = os.environ.get(key)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


WORKER_COUNT = _env_int("WORKER_COUNT", 1)

API_PROGRESS_END = 100
logger = get_logger("foreverjukebox.worker")


class JobFailure(Exception):
    def __init__(self, message: str, output_lines: list[str] | None = None) -> None:
        super().__init__(message)
        self.output_lines = output_lines or []


def _extract_engine_error(output_lines: list[str]) -> str | None:
    for line in reversed(output_lines):
        message = line.strip()
        if message.startswith("ERROR:"):
            return message
    return None


def _worker_env() -> dict[str, str]:
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH")
    engine_path = str(ENGINE_REPO)
    if existing_pythonpath:
        env["PYTHONPATH"] = f"{engine_path}{os.pathsep}{existing_pythonpath}"
    else:
        env["PYTHONPATH"] = engine_path
    env["ENGINE_PROGRESS"] = "true"
    return env


def run_job(job_id: str, input_path: str, output_path: str) -> None:
    if not ENGINE_REPO.exists():
        raise RuntimeError("ENGINE_REPO is not set or missing")

    env = _worker_env()

    input_abs = abs_storage_path(STORAGE_ROOT, input_path)
    if not input_abs.exists():
        candidates = sorted((STORAGE_ROOT / "audio").glob(f"{job_id}.*"))
        if candidates:
            input_abs = candidates[0]
    output_abs = abs_storage_path(STORAGE_ROOT, output_path)
    output_abs.parent.mkdir(parents=True, exist_ok=True)

    def map_engine_progress(value: int) -> int:
        return max(0, min(API_PROGRESS_END, int(value)))

    cmd = [
        sys.executable,
        "-m",
        "app.main",
        str(input_abs),
        "-o",
        str(output_abs),
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        cwd=str(ENGINE_REPO),
        bufsize=1,
    )
    assert proc.stdout is not None
    output_lines: list[str] = []
    for line in proc.stdout:
        if line.startswith("PROGRESS:"):
            parts = line.strip().split(":", 2)
            if len(parts) >= 2:
                try:
                    progress = map_engine_progress(int(parts[1]))
                    set_job_progress(DB_PATH, job_id, progress)
                except ValueError:
                    pass
            continue
        output_lines.append(line)
        logger.info("%s", line.rstrip())
    returncode = proc.wait()
    if returncode != 0:
        message = _extract_engine_error(output_lines) or f"Engine exited with status {returncode}"
        raise JobFailure(message, output_lines)


def apply_track_metadata(output_path: str, title: str | None, artist: str | None) -> None:
    if not title and not artist:
        return
    result_path = abs_storage_path(STORAGE_ROOT, output_path)
    if not result_path.exists():
        return
    try:
        data = json.loads(result_path.read_text(encoding="utf-8"))
    except Exception:
        return
    track = data.get("track") if isinstance(data, dict) else None
    if not isinstance(track, dict):
        track = {}
        data["track"] = track
    if title:
        track["title"] = title
    if artist:
        track["artist"] = artist
    result_path.write_text(json.dumps(data), encoding="utf-8")


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _extract_track_duration_seconds(output_path: str) -> float | None:
    result_path = abs_storage_path(STORAGE_ROOT, output_path)
    if not result_path.exists():
        return None
    try:
        data = json.loads(result_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    track = data.get("track")
    if not isinstance(track, dict):
        return None
    value = track.get("duration")
    if isinstance(value, (int, float)):
        duration_s = float(value)
        if duration_s > 0:
            return duration_s
    return None


def cleanup_failed_job(job, error: Exception) -> None:
    log_dir = STORAGE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job.id}.log"
    output_lines: list[str] = []
    if isinstance(error, JobFailure):
        output_lines = error.output_lines
    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Job failed: {error}\n")
        if output_lines:
            log_file.write("\n--- Engine output ---\n")
            for line in output_lines:
                log_file.write(line)
    if job.input_path:
        input_path = abs_storage_path(STORAGE_ROOT, job.input_path)
        if input_path.is_file():
            input_path.unlink()
    if job.output_path:
        output_path = abs_storage_path(STORAGE_ROOT, job.output_path)
        if output_path.is_file():
            output_path.unlink()
    set_job_status(DB_PATH, job.id, "failed", str(error))
    log_event(
        "job_failed",
        job_id=job.id,
        source=job.source_provider or "unknown",
        error_code=failure_code_for(str(error)),
        stage="analysis",
    )
    logger.info("Job %s failed: %s (log: %s)", job.id, error, log_path)


def run_worker_loop() -> None:
    init_db(DB_PATH)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "audio").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "analysis").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "logs").mkdir(parents=True, exist_ok=True)

    while True:
        job = claim_next_job(DB_PATH)
        if not job:
            time.sleep(1.0)
            continue
        try:
            run_job(job.id, job.input_path, job.output_path)
            apply_track_metadata(job.output_path, job.track_title, job.track_artist)
            set_job_progress(DB_PATH, job.id, 100)
        except Exception as exc:
            cleanup_failed_job(job, exc)
            continue
        set_job_status(DB_PATH, job.id, "complete", None)
        created_at = _parse_timestamp(job.created_at)
        elapsed_ms: int | None = None
        if created_at is not None:
            elapsed_ms = max(
                0,
                int((datetime.now(timezone.utc) - created_at).total_seconds() * 1000),
            )
        log_event(
            "job_completed",
            job_id=job.id,
            source=job.source_provider or "unknown",
            duration_s=_extract_track_duration_seconds(job.output_path),
            elapsed_ms=elapsed_ms,
        )

def main() -> None:
    init_db(DB_PATH)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "audio").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "analysis").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "logs").mkdir(parents=True, exist_ok=True)
    recovered_jobs = recover_stalled_processing_jobs(DB_PATH)
    if recovered_jobs > 0:
        logger.info("Recovered %s stalled processing job(s) back to queue", recovered_jobs)

    if WORKER_COUNT <= 1:
        run_worker_loop()
        return

    logger.info("Starting %s worker processes", WORKER_COUNT)
    procs: list[multiprocessing.Process] = []
    for idx in range(WORKER_COUNT):
        proc = multiprocessing.Process(target=run_worker_loop, name=f"worker-{idx + 1}")
        proc.start()
        procs.append(proc)

    try:
        for proc in procs:
            proc.join()
    except KeyboardInterrupt:
        logger.info("Stopping worker processes...")
        for proc in procs:
            proc.terminate()
        for proc in procs:
            proc.join()


if __name__ == "__main__":
    main()
