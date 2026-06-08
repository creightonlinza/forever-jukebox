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
from api.db import claim_next_job, create_job, get_job, init_db, recover_stalled_processing_jobs, set_job_status
from api.models import AnalysisUrlRequest
from api.routes import jobs
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
                            id, source_ref, status, input_path, output_path,
                            error, progress, created_at, updated_at
                        )
                        VALUES ('orphan', 'missing-source', 'queued', '', '', NULL, 0, 'now', 'now')
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
                    f"audio/job-{index}.mp3",
                    f"analysis/job-{index}.json",
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
            create_job(db_path, "locked-job", "audio/locked.mp3", "analysis/locked.json", "queued")
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
            create_job(db_path, "rollback-job", "audio/rollback.mp3", "analysis/rollback.json", "queued")

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
                "audio/existing.mp3",
                "analysis/existing.json",
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
                    "audio/new.mp3",
                    "analysis/new.json",
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

            create_job(db_path, "stalled", "audio/stalled.mp3", "analysis/stalled.json", "processing")
            create_job(db_path, "failed", "audio/failed.mp3", "analysis/failed.json", "queued")
            create_job(db_path, "errored", "audio/errored.mp3", "analysis/errored.json", "queued")
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
                    "audio/failed.m4a",
                    "analysis/failed.json",
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
                    "audio/failed-source.m4a",
                    "analysis/failed-source.json",
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

    def test_create_source_job_replaces_retryable_failed_job_by_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-source-job",
                    "",
                    "analysis/retryable-source.json",
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
                self.assertNotEqual(payload["id"], "retryable-source-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
                original = get_job(db_path, "retryable-source-job")
                self.assertEqual(original.status, "failed")
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 2)
            finally:
                jobs.DB_PATH = original_db_path

    def test_create_source_job_replaces_retryable_failed_job_by_track(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-track-job",
                    "",
                    "analysis/retryable-track.json",
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
                self.assertNotEqual(payload["id"], "retryable-track-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
                original = get_job(db_path, "retryable-track-job")
                self.assertEqual(original.status, "failed")
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 2)
            finally:
                jobs.DB_PATH = original_db_path

    def test_by_source_lookup_treats_retryable_failed_job_as_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-lookup-job",
                    "",
                    "analysis/retryable-lookup.json",
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
                with self.assertRaises(jobs.HTTPException) as raised:
                    jobs.get_job_by_source_route("youtube", "yt-lookup", background_tasks)

                self.assertEqual(raised.exception.status_code, 404)
                self.assertEqual(len(background_tasks.tasks), 0)
            finally:
                jobs.DB_PATH = original_db_path

    def test_by_track_lookup_treats_retryable_failed_job_as_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-track-lookup-job",
                    "",
                    "analysis/retryable-track-lookup.json",
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
                with self.assertRaises(jobs.HTTPException) as raised:
                    jobs.get_job_by_track_match(background_tasks, title="Song", artist="Artist")

                self.assertEqual(raised.exception.status_code, 404)
                self.assertEqual(len(background_tasks.tasks), 0)
            finally:
                jobs.DB_PATH = original_db_path

    def test_url_start_replaces_retryable_failed_youtube_job_without_metadata_probe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            init_db(db_path)
            original_db_path = jobs.DB_PATH
            jobs.DB_PATH = db_path
            try:
                create_job(
                    db_path,
                    "retryable-url-job",
                    "",
                    "analysis/retryable-url.json",
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
                    patch.object(jobs, "resolve_source_info", side_effect=AssertionError),
                ):
                    response = jobs.create_analysis_url(
                        background_tasks,
                        AnalysisUrlRequest(url="https://www.youtube.com/watch?v=jfKfPfyJRdk"),
                    )

                self.assertEqual(response.status_code, 202)
                payload = json.loads(response.body)
                self.assertNotEqual(payload["id"], "retryable-url-job")
                self.assertEqual(payload["status"], "downloading")
                self.assertEqual(len(background_tasks.tasks), 1)
                original = get_job(db_path, "retryable-url-job")
                self.assertEqual(original.status, "failed")
                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                self.assertEqual(row[0], 2)
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
