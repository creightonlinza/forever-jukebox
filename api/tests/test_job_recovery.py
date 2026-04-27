from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from api.db import create_job, get_job, init_db, recover_stalled_processing_jobs, set_job_status
from api.routes.jobs import _should_attempt_auto_repair
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


if __name__ == "__main__":
    unittest.main()
