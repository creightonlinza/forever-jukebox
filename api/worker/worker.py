"""Background worker that runs analysis jobs."""

from __future__ import annotations

import gzip
import json
import os
import shutil
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
from api.routes.jobs_runtime import failure_code_for, log_event, maybe_notify_youtube_failures
from api.storage import StorageError, discard_job_files, get_store
from api.utils import get_logger

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
# Back-off before claiming more work after the bucket fails, so an outage doesn't spin the queue.
STORAGE_RETRY_DELAY_S = 30.0
# Storage errors a job may hit before it fails; counted per worker process, reset on restart.
STORAGE_RETRY_LIMIT = 5
_storage_failures: dict[str, int] = {}
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


def run_job(
    job_id: str,
    title: str | None = None,
    artist: str | None = None,
) -> float | None:
    """Analyse the job's audio and store the result; returns the track duration if known."""
    if not ENGINE_REPO.exists():
        raise RuntimeError("ENGINE_REPO is not set or missing")

    env = _worker_env()
    store = get_store(STORAGE_ROOT)
    with store.local_audio(job_id) as input_abs:
        if input_abs is None:
            raise JobFailure("Audio file is missing")
        output_abs = store.analysis_output_path(job_id)
        output_abs.parent.mkdir(parents=True, exist_ok=True)
        _run_engine(job_id, input_abs, output_abs, env, title, artist)
    if not output_abs.is_file():
        return None
    duration_s = _track_duration_seconds(output_abs)
    store.save_analysis(job_id, compress_analysis(output_abs))
    return duration_s


def _run_engine(
    job_id: str,
    input_abs: Path,
    output_abs: Path,
    env: dict[str, str],
    title: str | None,
    artist: str | None,
) -> None:
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
    if title:
        cmd.extend(["--title", title])
    if artist:
        cmd.extend(["--artist", artist])

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


def compress_analysis(plain_path: Path) -> Path:
    """Replace a plain analysis JSON file with its gzipped sibling."""
    gz_path = plain_path.with_name(plain_path.name + ".gz")
    tmp_path = gz_path.with_name(gz_path.name + ".tmp")
    with plain_path.open("rb") as src, gzip.open(tmp_path, "wb") as dst:
        shutil.copyfileobj(src, dst)
    tmp_path.replace(gz_path)
    plain_path.unlink()
    return gz_path


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


def _completion_elapsed_ms(job) -> int | None:
    started_at = _parse_timestamp(job.updated_at)
    if started_at is None:
        started_at = _parse_timestamp(job.created_at)
    if started_at is None:
        return None
    return max(
        0,
        int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000),
    )


def _track_duration_seconds(plain_path: Path) -> float | None:
    try:
        data = json.loads(plain_path.read_text(encoding="utf-8"))
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


def cleanup_failed_job(job, error: Exception, discard_files: bool = True) -> None:
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
    if discard_files:
        discard_job_files(get_store(STORAGE_ROOT), job.id)
    set_job_status(DB_PATH, job.id, "failed", str(error))
    log_event(
        "job_failed",
        job_id=job.id,
        source=job.source_provider or "unknown",
        error_code=failure_code_for(str(error)),
        stage="analysis",
    )
    logger.info("Job %s failed: %s (log: %s)", job.id, error, log_path)


def handle_storage_error(job, error: StorageError) -> None:
    """Requeue the job with its stored audio; fail it, keeping the audio, after repeated errors."""
    attempts = _storage_failures.pop(job.id, 0) + 1
    if attempts >= STORAGE_RETRY_LIMIT:
        cleanup_failed_job(job, error, discard_files=False)
        return
    _storage_failures[job.id] = attempts
    logger.warning("Job %s requeued after storage error (%s): %s", job.id, attempts, error)
    set_job_progress(DB_PATH, job.id, 25)
    set_job_status(DB_PATH, job.id, "queued", None)
    log_event("job_requeued", job_id=job.id, source=job.source_provider or "unknown")


def run_worker_loop() -> None:
    init_db(DB_PATH)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "audio").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "analysis").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "logs").mkdir(parents=True, exist_ok=True)

    while True:
        maybe_notify_youtube_failures(DB_PATH)
        job = claim_next_job(DB_PATH)
        if not job:
            time.sleep(1.0)
            continue
        try:
            duration_s = run_job(job.id, job.track_title, job.track_artist)
            set_job_progress(DB_PATH, job.id, 100)
        except StorageError as exc:
            handle_storage_error(job, exc)
            time.sleep(STORAGE_RETRY_DELAY_S)
            continue
        except Exception as exc:
            _storage_failures.pop(job.id, None)
            cleanup_failed_job(job, exc)
            continue
        _storage_failures.pop(job.id, None)
        set_job_status(DB_PATH, job.id, "complete", None)
        log_event(
            "job_completed",
            job_id=job.id,
            source=job.source_provider or "unknown",
            duration_s=duration_s,
            elapsed_ms=_completion_elapsed_ms(job),
        )

def main() -> None:
    get_store(STORAGE_ROOT)
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
