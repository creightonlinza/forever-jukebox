from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import BackgroundTasks

from api import db as db_module
from api.db import (
    claim_next_job,
    create_job,
    get_job,
    get_recent_tracks,
    get_top_tracks,
    init_db,
    recover_stalled_processing_jobs,
    restart_failed_job,
    set_job_status,
)
from api.models import AnalysisUrlRequest
from api.routes import jobs, jobs_runtime as jobs_runtime_module
from api.routes.jobs import _create_source_job, _should_attempt_auto_repair
from api.routes.jobs_runtime import ANALYSIS_MISSING_MESSAGE, ERROR_YOUTUBE_LIVE
from worker import worker as worker_module


class JobRecoveryTests(unittest.TestCase):
    def test_init_db_enables_wal_busy_timeout_and_foreign_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"

            init_db(db_path)

            with db_module._connect(db_path) as conn:
                journal_mode = conn.execute("PRAGMA journal_mode").fetchone()
                busy_timeout = conn.execute("PRAGMA busy_timeout").fetchone()
                foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(
                        """
                        INSERT INTO jobs (
                            id, source_ref, status,
                            error, progress, created_at, updated_at
                        )
                        VALUES ('orphan', 'missing-source', 'queued', NULL, 0, 'now', 'now')
                        """
                    )

            self.assertEqual(journal_mode[0].lower(), "wal")
            self.assertGreaterEqual(int(busy_timeout[0]), db_module.SQLITE_BUSY_TIMEOUT_MS)
            self.assertEqual(int(foreign_keys[0]), 1)

    def test_concurrent_claims_are_unique_with_six_workers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            for index in range(6):
                create_job(
                    db_path,
                    f"job-{index}",
                    "queued",
                )

            def claim_id() -> str | None:
                job = claim_next_job(db_path)
                return job.id if job else None

            with ThreadPoolExecutor(max_workers=6) as executor:
                claimed_ids = list(executor.map(lambda _: claim_id(), range(6)))

            self.assertEqual(len(set(claimed_ids)), 6)
            self.assertNotIn(None, claimed_ids)
            for job_id in claimed_ids:
                self.assertEqual(get_job(db_path, str(job_id)).status, "processing")

    def test_claim_next_job_returns_none_when_database_stays_locked(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            create_job(db_path, "locked-job", "queued")
            lock_conn = sqlite3.connect(db_path, timeout=0.01)
            lock_conn.isolation_level = None
            lock_conn.execute("BEGIN IMMEDIATE")
            try:
                with (
                    patch.object(db_module, "CLAIM_BUSY_TIMEOUT_MS", 10),
                    patch.object(db_module, "CLAIM_RETRY_DELAYS_S", (0.01,)),
                    patch.object(db_module.time, "sleep"),
                ):
                    self.assertIsNone(claim_next_job(db_path))
            finally:
                lock_conn.execute("ROLLBACK")
                lock_conn.close()

            self.assertEqual(get_job(db_path, "locked-job").status, "queued")

    def test_claim_next_job_rolls_back_after_mid_transaction_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            create_job(db_path, "rollback-job", "queued")

            with patch.object(db_module, "_utc_now", side_effect=RuntimeError("forced failure")):
                with self.assertRaisesRegex(RuntimeError, "forced failure"):
                    claim_next_job(db_path)

            claimed = claim_next_job(db_path)

            self.assertIsNotNone(claimed)
            self.assertEqual(claimed.id, "rollback-job")
            self.assertEqual(get_job(db_path, "rollback-job").status, "processing")

    def test_create_job_recovers_when_source_is_inserted_between_lookup_and_insert(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            create_job(
                db_path,
                "existing-job",
                "queued",
                track_title="Original Title",
                track_artist="Original Artist",
                source_id="yt-race",
                source_provider="youtube",
                source_url="https://www.youtube.com/watch?v=yt-race",
            )
            original_lookup = db_module._lookup_source_for_job
            lookup_calls = 0

            def simulate_stale_first_lookup(conn, *, provider, source_id, source_url):
                nonlocal lookup_calls
                lookup_calls += 1
                if lookup_calls == 1:
                    return None
                return original_lookup(
                    conn,
                    provider=provider,
                    source_id=source_id,
                    source_url=source_url,
                )

            with patch.object(db_module, "_lookup_source_for_job", side_effect=simulate_stale_first_lookup):
                create_job(
                    db_path,
                    "new-job",
                    "queued",
                    track_title="New Title",
                    track_artist="New Artist",
                    source_id="yt-race",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-race",
                )

            self.assertGreaterEqual(lookup_calls, 2)
            with db_module._connect(db_path) as conn:
                source_count = conn.execute("SELECT COUNT(*) FROM sources").fetchone()
                job_count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()

            self.assertEqual(source_count[0], 1)
            self.assertEqual(job_count[0], 2)

    def test_recover_stalled_processing_jobs_leaves_failed_and_errored_jobs_alone(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)

            create_job(db_path, "stalled", "processing")
            create_job(db_path, "failed", "queued")
            create_job(db_path, "errored", "queued")
            set_job_status(db_path, "failed", "failed", "Download failed")
            set_job_status(db_path, "errored", "processing", "Engine exited with status 1")

            recovered = recover_stalled_processing_jobs(db_path)

            self.assertEqual(recovered, 1)
            self.assertEqual(get_job(db_path, "stalled").status, "queued")
            failed = get_job(db_path, "failed")
            self.assertEqual(failed.status, "failed")
            self.assertEqual(failed.error, "Download failed")
            errored = get_job(db_path, "errored")
            self.assertEqual(errored.status, "processing")
            self.assertEqual(errored.error, "Engine exited with status 1")

    def test_restart_failed_job_atomically_resets_retry_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            create_job(
                db_path,
                "retryable",
                status="queued",
            )
            set_job_status(db_path, "retryable", "failed", "Download failed")
            failed = get_job(db_path, "retryable")

            self.assertTrue(restart_failed_job(db_path, failed.id, failed.updated_at))
            self.assertFalse(restart_failed_job(db_path, failed.id, failed.updated_at))

            restarted = get_job(db_path, failed.id)
            self.assertEqual(restarted.status, "downloading")
            self.assertIsNone(restarted.error)
            self.assertEqual(restarted.progress, 0)
            self.assertEqual(restarted.created_at, restarted.updated_at)
            self.assertNotEqual(restarted.updated_at, failed.updated_at)
            with sqlite3.connect(db_path) as conn:
                row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
            self.assertEqual(row[0], 1)

    def test_stale_failure_log_only_recycles_when_newer_than_job_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            storage_root = Path(temp_dir)
            log_path = storage_root / "logs" / "downloading.log"
            log_path.parent.mkdir(parents=True)
            log_path.write_text("Job failed", encoding="utf-8")
            updated_at = datetime.now(timezone.utc)
            job = SimpleNamespace(
                id="downloading",
                status="downloading",
                progress=0,
                updated_at=updated_at.isoformat(),
            )

            old_log_time = (updated_at - timedelta(seconds=60)).timestamp()
            os.utime(log_path, (old_log_time, old_log_time))
            with patch.object(jobs_runtime_module, "STORAGE_ROOT", storage_root):
                self.assertFalse(jobs_runtime_module.should_recycle_job(job))

            new_log_time = (updated_at + timedelta(seconds=1)).timestamp()
            os.utime(log_path, (new_log_time, new_log_time))
            with patch.object(jobs_runtime_module, "STORAGE_ROOT", storage_root):
                self.assertTrue(jobs_runtime_module.should_recycle_job(job))

    def test_retry_job_route_restarts_supported_source_providers(self) -> None:
        providers = (
            (
                "youtube",
                "yt-retry-id",
                "https://www.youtube.com/watch?v=yt-retry-id",
            ),
            (
                "soundcloud",
                None,
                "https://soundcloud.com/artist/retry-track",
            ),
            (
                "bandcamp",
                None,
                "https://artist.bandcamp.com/track/retry-track",
            ),
        )
        for provider, source_id, source_url in providers:
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as temp_dir:
                db_path = Path(temp_dir) / "jobs.db"
                storage_root = Path(temp_dir) / "storage"
                init_db(db_path)
                original_db_path = jobs.DB_PATH
                jobs.DB_PATH = db_path
                try:
                    job_id = f"{provider}-retry-job"
                    create_job(
                        db_path,
                        job_id,
                        status="queued",
                        source_id=source_id,
                        source_provider=provider,
                        source_url=source_url,
                    )
                    set_job_status(
                        db_path,
                        job_id,
                        "failed",
                        "ERROR: Unable to download video data.",
                    )
                    background_tasks = BackgroundTasks()

                    with patch.object(jobs, "STORAGE_ROOT", storage_root):
                        response = jobs.retry_job_by_id(job_id, background_tasks)

                    self.assertEqual(response.status_code, 202)
                    payload = json.loads(response.body)
                    self.assertEqual(payload["id"], job_id)
                    self.assertEqual(payload["status"], "downloading")
                    self.assertEqual(payload["source_provider"], provider)
                    self.assertEqual(len(background_tasks.tasks), 1)
                    task = background_tasks.tasks[0]
                    self.assertEqual(task.args[0], job_id)
                    self.assertEqual(task.args[1], source_url)
                    self.assertEqual(task.args[3], provider)
                finally:
                    jobs.DB_PATH = original_db_path

    def test_retry_job_route_returns_non_retryable_failure_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "permanent-failure",
                    status="queued",
                    source_id="yt-permanent",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-permanent",
                )
                set_job_status(
                    db_path,
                    "permanent-failure",
                    "failed",
                    "ERROR: No beats or downbeats were detected in this audio.",
                )
                background_tasks = BackgroundTasks()

                response = jobs.retry_job_by_id("permanent-failure", background_tasks)

                self.assertEqual(response.status_code, 200)
                payload = json.loads(response.body)
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(payload["error_code"], "no_beats_detected")
                self.assertEqual(len(background_tasks.tasks), 0)
            finally:
                jobs.DB_PATH = original_db_path

    def test_retry_job_route_returns_active_and_complete_jobs_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "active-job",
                    status="downloading",
                    source_id="yt-active",
                    source_provider="youtube",
                )
                active_tasks = BackgroundTasks()
                active_response = jobs.retry_job_by_id("active-job", active_tasks)

                analysis_path = storage_root / "analysis" / "complete-job.json"
                analysis_path.parent.mkdir(parents=True, exist_ok=True)
                analysis_path.write_text(
                    json.dumps({"track": {"title": "Complete"}}),
                    encoding="utf-8",
                )
                create_job(
                    db_path,
                    "complete-job",
                    status="complete",
                    source_url="https://soundcloud.com/artist/complete",
                    source_provider="soundcloud",
                )
                complete_tasks = BackgroundTasks()
                with patch.object(jobs, "STORAGE_ROOT", storage_root):
                    complete_response = jobs.retry_job_by_id(
                        "complete-job",
                        complete_tasks,
                    )

                self.assertEqual(active_response.status_code, 202)
                self.assertEqual(json.loads(active_response.body)["status"], "downloading")
                self.assertEqual(len(active_tasks.tasks), 0)
                self.assertEqual(complete_response.status_code, 200)
                self.assertEqual(json.loads(complete_response.body)["status"], "complete")
                self.assertEqual(len(complete_tasks.tasks), 0)
            finally:
                jobs.DB_PATH = original_db_path

    def test_retry_job_route_returns_not_found_for_missing_job(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                with self.assertRaises(jobs.HTTPException) as raised:
                    jobs.retry_job_by_id("missing", BackgroundTasks())

                self.assertEqual(raised.exception.status_code, 404)
            finally:
                jobs.DB_PATH = original_db_path

    def test_concurrent_retry_job_requests_schedule_one_download(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retry-route-race",
                    status="queued",
                    source_provider="bandcamp",
                    source_url="https://artist.bandcamp.com/track/retry-race",
                )
                set_job_status(
                    db_path,
                    "retry-route-race",
                    "failed",
                    "ERROR: Unable to download video data.",
                )

                def retry_job() -> tuple[dict, int]:
                    background_tasks = BackgroundTasks()
                    response = jobs.retry_job_by_id(
                        "retry-route-race",
                        background_tasks,
                    )
                    return json.loads(response.body), len(background_tasks.tasks)

                with (
                    patch.object(jobs, "STORAGE_ROOT", storage_root),
                    ThreadPoolExecutor(max_workers=2) as executor,
                ):
                    results = list(executor.map(lambda _: retry_job(), range(2)))

                self.assertEqual(
                    [payload["status"] for payload, _ in results],
                    ["downloading", "downloading"],
                )
                self.assertEqual(sum(task_count for _, task_count in results), 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_failed_jobs_do_not_auto_repair(self) -> None:
        job = SimpleNamespace(status="failed", error=ANALYSIS_MISSING_MESSAGE)

        self.assertFalse(_should_attempt_auto_repair(job))

    def test_retryable_download_jobs_do_not_auto_repair_on_poll(self) -> None:
        job = SimpleNamespace(status="failed", error="ERROR: [youtube] abc123def45: Premieres in 3 hours")

        self.assertFalse(_should_attempt_auto_repair(job))

    def test_completion_elapsed_prefers_claim_timestamp(self) -> None:
        old_created_at = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        fresh_updated_at = (datetime.now(timezone.utc) - timedelta(seconds=2)).isoformat()
        job = SimpleNamespace(created_at=old_created_at, updated_at=fresh_updated_at)

        elapsed_ms = worker_module._completion_elapsed_ms(job)

        self.assertIsNotNone(elapsed_ms)
        self.assertLess(elapsed_ms, 10000)

    def test_create_source_job_reuses_failed_job_until_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "failed-job",
                    status="queued",
                    track_title="Song",
                    track_artist="Artist",
                    source_id="yt-failed",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-failed",
                )
                set_job_status(db_path, "failed-job", "failed", "Engine exited with status 1")

                background_tasks = BackgroundTasks()
                response = _create_source_job(
                    background_tasks,
                    source_id="yt-failed",
                    source_url="https://www.youtube.com/watch?v=yt-failed",
                    source_provider="youtube",
                    track_title="Song",
                    track_artist="Artist",
                )

                self.assertEqual(response.status_code, 200)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "failed-job")
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(len(background_tasks.tasks), 0)
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_create_source_job_reuses_failed_job_by_source_until_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "failed-source-job",
                    status="queued",
                    track_title="Original Title",
                    track_artist="Original Artist",
                    source_id="yt-failed",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-failed",
                )
                set_job_status(
                    db_path,
                    "failed-source-job",
                    "failed",
                    "ERROR: No beats or downbeats were detected in this audio.",
                )

                background_tasks = BackgroundTasks()
                response = _create_source_job(
                    background_tasks,
                    source_id="yt-failed",
                    source_url="https://www.youtube.com/watch?v=yt-failed",
                    source_provider="youtube",
                    track_title="Different Title",
                    track_artist="Different Artist",
                )

                self.assertEqual(response.status_code, 200)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "failed-source-job")
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(len(background_tasks.tasks), 0)
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_create_source_job_restarts_retryable_failed_job_by_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                audio_path = storage_root / "audio" / "retryable-source-job.m4a"
                analysis_path = storage_root / "analysis" / "retryable-source-job.json"
                log_path = storage_root / "logs" / "retryable-source-job.log"
                for path in (audio_path, analysis_path, log_path):
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("stale", encoding="utf-8")
                create_job(
                    db_path,
                    "retryable-source-job",
                    status="queued",
                    track_title="Original Title",
                    track_artist="Original Artist",
                    source_id="yt-retry",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-retry",
                )
                set_job_status(
                    db_path,
                    "retryable-source-job",
                    "failed",
                    "ERROR: [youtube] yt-retry: Premieres in 3 hours",
                )

                background_tasks = BackgroundTasks()
                with patch.object(jobs, "STORAGE_ROOT", storage_root):
                    response = _create_source_job(
                        background_tasks,
                        source_id="yt-retry",
                        source_url="https://www.youtube.com/watch?v=yt-retry",
                        source_provider="youtube",
                        track_title="Different Title",
                        track_artist="Different Artist",
                    )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "retryable-source-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
                restarted = get_job(db_path, "retryable-source-job")
                self.assertEqual(restarted.status, "downloading")
                self.assertIsNone(restarted.error)
                self.assertEqual(restarted.progress, 0)
                self.assertFalse(audio_path.exists())
                self.assertFalse(analysis_path.exists())
                self.assertFalse(log_path.exists())
                with patch.object(jobs_runtime_module, "STORAGE_ROOT", storage_root):
                    self.assertFalse(jobs_runtime_module.should_recycle_job(restarted))
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_create_source_job_restarts_retryable_failed_job_by_track(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-track-job",
                    status="queued",
                    track_title="Song",
                    track_artist="Artist",
                    source_id="yt-track",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-track",
                )
                set_job_status(
                    db_path,
                    "retryable-track-job",
                    "failed",
                    "ERROR: \r[download] Got error: partial read",
                )

                background_tasks = BackgroundTasks()
                with patch.object(jobs, "STORAGE_ROOT", storage_root):
                    response = _create_source_job(
                        background_tasks,
                        source_id="yt-track",
                        source_url="https://www.youtube.com/watch?v=yt-track",
                        source_provider="youtube",
                        track_title="Song",
                        track_artist="Artist",
                    )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "retryable-track-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
                restarted = get_job(db_path, "retryable-track-job")
                self.assertEqual(restarted.status, "downloading")
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_concurrent_source_retries_schedule_one_download(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-race-job",
                    status="queued",
                    source_id="yt-race-retry",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-race-retry",
                )
                set_job_status(
                    db_path,
                    "retryable-race-job",
                    "failed",
                    "ERROR: Unable to download video data.",
                )

                def retry_job() -> tuple[dict, int]:
                    background_tasks = BackgroundTasks()
                    response = _create_source_job(
                        background_tasks,
                        source_id="yt-race-retry",
                        source_url="https://www.youtube.com/watch?v=yt-race-retry",
                        source_provider="youtube",
                        track_title=None,
                        track_artist=None,
                    )
                    return json.loads(response.body), len(background_tasks.tasks)

                with (
                    patch.object(jobs, "STORAGE_ROOT", storage_root),
                    ThreadPoolExecutor(max_workers=2) as executor,
                ):
                    results = list(executor.map(lambda _: retry_job(), range(2)))

                self.assertEqual(
                    [payload["id"] for payload, _ in results],
                    ["retryable-race-job", "retryable-race-job"],
                )
                self.assertEqual([payload["status"] for payload, _ in results], ["downloading"] * 2)
                self.assertEqual(sum(task_count for _, task_count in results), 1)
                self.assertEqual(get_job(db_path, "retryable-race-job").status, "downloading")
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_by_source_lookup_restarts_retryable_failed_job(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-lookup-job",
                    status="queued",
                    source_id="yt-lookup",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-lookup",
                )
                set_job_status(
                    db_path,
                    "retryable-lookup-job",
                    "failed",
                    "ERROR: Unable to download video data.",
                )

                background_tasks = BackgroundTasks()
                with patch.object(jobs, "STORAGE_ROOT", storage_root):
                    response = jobs.get_job_by_source_route(
                        "youtube",
                        "yt-lookup",
                        background_tasks,
                    )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "retryable-lookup-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_by_source_lookup_returns_job_id_with_source_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "lookup-job-id",
                    status="queued",
                    source_id="yt-lookup-id",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-lookup-id",
                )

                response = jobs.get_job_by_source_route(
                    "youtube",
                    "yt-lookup-id",
                    BackgroundTasks(),
                )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "lookup-job-id")
                self.assertEqual(payload["source_id"], "yt-lookup-id")
                self.assertEqual(payload["source_provider"], "youtube")
            finally:
                jobs.DB_PATH = original_db_path

    def test_track_lists_use_job_id_and_keep_youtube_source_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            create_job(
                db_path,
                "top-job-id",
                status="queued",
                track_title="Song",
                track_artist="Artist",
                source_id="yt-top-id",
                source_provider="youtube",
                source_url="https://www.youtube.com/watch?v=yt-top-id",
                play_count=3,
            )

            top_item = get_top_tracks(db_path, limit=1)[0]
            recent_item = get_recent_tracks(db_path, limit=1)[0]

            for item in (top_item, recent_item):
                self.assertEqual(item["id"], "top-job-id")
                self.assertEqual(item["source_id"], "yt-top-id")
                self.assertEqual(item["source_provider"], "youtube")

    def test_by_track_lookup_restarts_retryable_failed_job(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-track-lookup-job",
                    status="queued",
                    track_title="Song",
                    track_artist="Artist",
                    source_id="yt-track-l",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-track-l",
                )
                set_job_status(
                    db_path,
                    "retryable-track-lookup-job",
                    "failed",
                    "ERROR: Sign in to confirm you're not a bot",
                )

                background_tasks = BackgroundTasks()
                with patch.object(jobs, "STORAGE_ROOT", storage_root):
                    response = jobs.get_job_by_track_match(
                        background_tasks,
                        title="Song",
                        artist="Artist",
                    )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "retryable-track-lookup-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_url_start_restarts_retryable_failed_youtube_job_without_metadata_probe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-url-job",
                    status="queued",
                    source_id="jfKfPfyJRdk",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=jfKfPfyJRdk",
                )
                set_job_status(
                    db_path,
                    "retryable-url-job",
                    "failed",
                    "ERROR: [youtube] jfKfPfyJRdk: Premieres in 3 hours",
                )

                background_tasks = BackgroundTasks()
                with (
                    patch.dict(os.environ, {"ALLOW_USER_URL": "true"}),
                    patch.object(jobs, "STORAGE_ROOT", storage_root),
                    patch.object(jobs, "resolve_source_info", side_effect=AssertionError),
                ):
                    response = jobs.create_analysis_url(
                        background_tasks,
                        AnalysisUrlRequest(url="https://www.youtube.com/watch?v=jfKfPfyJRdk"),
                    )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertEqual(payload["id"], "retryable-url-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
                restarted = get_job(db_path, "retryable-url-job")
                self.assertEqual(restarted.status, "downloading")
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 1)
            finally:
                jobs.DB_PATH = original_db_path

    def test_original_job_id_poll_observes_retry_then_completion(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "durable-job-id",
                    status="queued",
                    source_id="yt-durable",
                    source_provider="youtube",
                    source_url="https://www.youtube.com/watch?v=yt-durable",
                )
                set_job_status(
                    db_path,
                    "durable-job-id",
                    "failed",
                    "ERROR: Unable to download video data.",
                )

                retry_tasks = BackgroundTasks()
                with patch.object(jobs, "STORAGE_ROOT", storage_root):
                    retry_response = _create_source_job(
                        retry_tasks,
                        source_id="yt-durable",
                        source_url="https://www.youtube.com/watch?v=yt-durable",
                        source_provider="youtube",
                        track_title=None,
                        track_artist=None,
                    )
                    poll_tasks = BackgroundTasks()
                    polling_response = jobs.get_analysis("durable-job-id", poll_tasks)

                    audio_path = storage_root / "audio" / "durable-job-id.m4a"
                    analysis_path = storage_root / "analysis" / "durable-job-id.json"
                    audio_path.parent.mkdir(parents=True, exist_ok=True)
                    analysis_path.parent.mkdir(parents=True, exist_ok=True)
                    audio_path.write_bytes(b"audio")
                    analysis_path.write_text(
                        json.dumps({"track": {"title": "Durable"}}),
                        encoding="utf-8",
                    )
                    set_job_status(db_path, "durable-job-id", "complete", None)
                    completed_response = jobs.get_analysis(
                        "durable-job-id",
                        BackgroundTasks(),
                    )

                self.assertEqual(json.loads(retry_response.body)["id"], "durable-job-id")
                self.assertEqual(json.loads(polling_response.body)["status"], "downloading")
                self.assertEqual(len(poll_tasks.tasks), 0)
                completed_payload = json.loads(completed_response.body)
                self.assertEqual(completed_payload["id"], "durable-job-id")
                self.assertEqual(completed_payload["status"], "complete")
            finally:
                jobs.DB_PATH = original_db_path

    def test_url_start_normalizes_metadata_probe_download_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                background_tasks = BackgroundTasks()
                raw_error = (
                    "ERROR: [youtube] jfKfPfyJRdk: Sign in to confirm you're not a bot. "
                    "Use --cookies-from-browser or --cookies for the authentication."
                )
                with (
                    patch.dict(os.environ, {"ALLOW_USER_URL": "true"}),
                    patch.object(jobs, "resolve_source_info", side_effect=Exception(raw_error)),
                ):
                    with self.assertRaises(jobs.HTTPException) as raised:
                        jobs.create_analysis_url(
                            background_tasks,
                            AnalysisUrlRequest(url="https://youtu.be/notindb1234"),
                        )

                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(
                    raised.exception.detail,
                    {
                        "message": "ERROR: Unable to reach YouTube",
                        "error_code": "youtube_unreachable",
                    },
                )
                self.assertEqual(len(background_tasks.tasks), 0)
            finally:
                jobs.DB_PATH = original_db_path

    def test_url_start_normalizes_live_youtube_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                background_tasks = BackgroundTasks()
                with (
                    patch.dict(os.environ, {"ALLOW_USER_URL": "true"}),
                    patch.object(jobs, "resolve_source_info", side_effect=ValueError(ERROR_YOUTUBE_LIVE)),
                ):
                    with self.assertRaises(jobs.HTTPException) as raised:
                        jobs.create_analysis_url(
                            background_tasks,
                            AnalysisUrlRequest(url="https://www.youtube.com/watch?v=livevideo1x"),
                        )

                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(
                    raised.exception.detail,
                    {
                        "message": ERROR_YOUTUBE_LIVE,
                        "error_code": "youtube_live",
                    },
                )
                self.assertEqual(len(background_tasks.tasks), 0)
            finally:
                jobs.DB_PATH = original_db_path


if __name__ == "__main__":
    unittest.main()
