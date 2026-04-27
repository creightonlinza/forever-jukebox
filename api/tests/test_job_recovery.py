from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import BackgroundTasks

from api.db import create_job, get_job, init_db, recover_stalled_processing_jobs, set_job_status
from api.routes import jobs
from api.routes.jobs import _create_source_job, _should_attempt_auto_repair
from api.routes.jobs_runtime import ANALYSIS_MISSING_MESSAGE


class JobRecoveryTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
