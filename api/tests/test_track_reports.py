from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from api.db import create_job, delete_job, get_reported_tracks, init_db
from api.models import TrackReportRequest
from api.routes import jobs as jobs_routes


class TrackReportsTest(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.db_path = Path(temp_dir.name) / "jobs.db"
        init_db(self.db_path)
        db_patch = patch.object(jobs_routes, "DB_PATH", self.db_path)
        db_patch.start()
        self.addCleanup(db_patch.stop)
        env_patch = patch.dict(os.environ, {"ADMIN_KEY": "secret"}, clear=True)
        env_patch.start()
        self.addCleanup(env_patch.stop)
        create_job(
            self.db_path,
            "job-1",
            status="complete",
            track_title="Song",
            track_artist="Artist",
            source_id="abc123",
            source_provider="youtube",
        )

    def _report(self, job_id: str, reason: str):
        return jobs_routes.report_track_by_id(job_id, TrackReportRequest(reason=reason))

    def test_report_is_stored_and_repeat_reports_are_ignored(self) -> None:
        first = self._report("job-1", "wrong_track")
        second = self._report("job-1", "bad_audio")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        items = get_reported_tracks(self.db_path)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "job-1")
        self.assertEqual(items[0]["reason"], "wrong_track")

    def test_report_for_unknown_job_returns_ok_without_a_row(self) -> None:
        response = self._report("missing-job", "other")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_reported_tracks(self.db_path), [])

    def test_list_requires_admin_key_and_returns_track_details(self) -> None:
        self._report("job-1", "bad_audio")

        for key in (None, "wrong"):
            with self.assertRaises(HTTPException) as ctx:
                jobs_routes.get_track_reports(admin_key=key)
            self.assertEqual(ctx.exception.status_code, 403)

        response = jobs_routes.get_track_reports(admin_key="secret")
        items = json.loads(response.body)["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "job-1")
        self.assertEqual(items[0]["title"], "Song")
        self.assertEqual(items[0]["artist"], "Artist")
        self.assertEqual(items[0]["source_provider"], "youtube")
        self.assertEqual(items[0]["reason"], "bad_audio")
        self.assertTrue(items[0]["reported_at"])

    def test_dismiss_requires_admin_key_and_removes_report(self) -> None:
        self._report("job-1", "other")

        with self.assertRaises(HTTPException) as ctx:
            jobs_routes.delete_track_report_by_id("job-1", admin_key=None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(len(get_reported_tracks(self.db_path)), 1)

        response = jobs_routes.delete_track_report_by_id("job-1", admin_key="secret")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_reported_tracks(self.db_path), [])

    def test_delete_job_removes_matching_report(self) -> None:
        create_job(
            self.db_path,
            "job-2",
            status="complete",
            track_title="Other Song",
            source_id="def456",
            source_provider="youtube",
        )
        self._report("job-1", "other")
        self._report("job-2", "other")

        delete_job(self.db_path, "job-1")

        self.assertEqual([item["id"] for item in get_reported_tracks(self.db_path)], ["job-2"])


if __name__ == "__main__":
    unittest.main()
