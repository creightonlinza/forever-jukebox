from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from api import db as db_module
from api.db import create_job, get_job, init_db
from api.models import StorageCleanupRequest
from api.routes import admin as admin_routes
from api.storage_cleanup import build_cleanup_preview, execute_cleanup


OLD_UPDATED_AT = "2000-01-01T00:00:00.000000+00:00"
RECENT_UPDATED_AT = "2999-01-01T00:00:00.000000+00:00"


def _write_file(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def _set_source_activity(db_path: Path, job_id: str, *, play_count: int, updated_at: str) -> None:
    with db_module._connect(db_path) as conn:
        conn.execute(
            """
            UPDATE sources
            SET play_count = ?, updated_at = ?
            WHERE id = (SELECT source_ref FROM jobs WHERE id = ?)
            """,
            (play_count, updated_at, job_id),
        )
        conn.commit()


def _job_count(db_path: Path) -> int:
    with db_module._connect(db_path) as conn:
        row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
    return int(row[0])


def _source_count(db_path: Path) -> int:
    with db_module._connect(db_path) as conn:
        row = conn.execute("SELECT COUNT(*) FROM sources").fetchone()
    return int(row[0])


def _make_job(
    db_path: Path,
    storage_root: Path,
    job_id: str,
    *,
    status: str = "complete",
    play_count: int = 1,
    updated_at: str = OLD_UPDATED_AT,
    title: str | None = None,
    audio_bytes: int = 3,
    analysis_bytes: int = 5,
    log_bytes: int = 7,
    write_files: bool = True,
) -> None:
    input_path = f"audio/{job_id}.m4a"
    output_path = f"analysis/{job_id}.json"
    create_job(
        db_path,
        job_id,
        input_path,
        output_path,
        status=status,
        track_title=title or f"Track {job_id}",
        track_artist="Artist",
        source_id=f"source-{job_id}",
        source_provider="youtube",
        source_url=f"https://www.youtube.com/watch?v=source-{job_id}",
    )
    _set_source_activity(db_path, job_id, play_count=play_count, updated_at=updated_at)
    if write_files:
        _write_file(storage_root / input_path, audio_bytes)
        _write_file(storage_root / output_path, analysis_bytes)
        _write_file(storage_root / "logs" / f"{job_id}.log", log_bytes)


class StorageCleanupTests(unittest.TestCase):
    def test_post_dry_run_requires_valid_admin_key(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            payload = StorageCleanupRequest()
            with (
                patch.dict(os.environ, {"ADMIN_KEY": "secret"}, clear=True),
                patch.object(admin_routes, "DB_PATH", db_path),
                patch.object(admin_routes, "STORAGE_ROOT", storage_root),
            ):
                with self.assertRaises(HTTPException) as missing:
                    admin_routes.run_storage_cleanup(payload, admin_key=None)
                with self.assertRaises(HTTPException) as wrong:
                    admin_routes.run_storage_cleanup(payload, admin_key="wrong")

                response = admin_routes.run_storage_cleanup(payload, admin_key="secret")

        self.assertEqual(missing.exception.status_code, 403)
        self.assertEqual(wrong.exception.status_code, 403)
        self.assertTrue(response.dry_run)
        self.assertEqual(response.candidate_jobs, 0)

    def test_preview_uses_defaults_and_does_not_delete(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "old-job")

            response = build_cleanup_preview(db_path, storage_root)

            self.assertTrue(response.dry_run)
            self.assertEqual(response.days, 90)
            self.assertEqual(response.play_count_below, 3)
            self.assertEqual(response.candidate_jobs, 1)
            self.assertEqual(response.candidate_bytes, 15)
            self.assertEqual(_job_count(db_path), 1)
            self.assertTrue((storage_root / "audio" / "old-job.m4a").exists())

    def test_preview_includes_at_most_ten_oldest_samples(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            for index in range(12):
                updated_at = f"2000-01-{index + 1:02d}T00:00:00.000000+00:00"
                _make_job(
                    db_path,
                    storage_root,
                    f"job-{index:02d}",
                    updated_at=updated_at,
                    title=f"Track {index:02d}",
                )

            response = build_cleanup_preview(db_path, storage_root)

        self.assertEqual(response.candidate_jobs, 12)
        self.assertEqual(len(response.sample), 10)
        self.assertEqual([item.job_id for item in response.sample], [f"job-{index:02d}" for index in range(10)])

    def test_execute_rejects_missing_or_wrong_confirmation(self) -> None:
        with patch.dict(os.environ, {"ADMIN_KEY": "secret"}, clear=True):
            for confirm in (None, "yes"):
                with self.subTest(confirm=confirm):
                    with self.assertRaises(HTTPException) as raised:
                        admin_routes.run_storage_cleanup(
                            StorageCleanupRequest(dry_run=False, confirm=confirm),
                            admin_key="secret",
                        )

                    self.assertEqual(raised.exception.status_code, 400)

    def test_post_rejects_when_cleanup_is_already_running(self) -> None:
        acquired = admin_routes._storage_cleanup_lock.acquire(blocking=False)
        self.assertTrue(acquired)
        try:
            with patch.dict(os.environ, {"ADMIN_KEY": "secret"}, clear=True):
                with self.assertRaises(HTTPException) as raised:
                    admin_routes.run_storage_cleanup(
                        StorageCleanupRequest(),
                        admin_key="secret",
                    )
        finally:
            admin_routes._storage_cleanup_lock.release()

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail, "Storage cleanup is already running")

    def test_post_releases_running_guard_after_confirmation_error(self) -> None:
        with patch.dict(os.environ, {"ADMIN_KEY": "secret"}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                admin_routes.run_storage_cleanup(
                    StorageCleanupRequest(dry_run=False),
                    admin_key="secret",
                )

            response = admin_routes.run_storage_cleanup(
                StorageCleanupRequest(),
                admin_key="secret",
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertTrue(response.dry_run)

    def test_execute_deletes_only_eligible_complete_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "eligible")
            _make_job(db_path, storage_root, "recent", updated_at=RECENT_UPDATED_AT)
            _make_job(db_path, storage_root, "popular", play_count=3)
            _make_job(db_path, storage_root, "queued", status="queued")

            response = execute_cleanup(db_path, storage_root)

            self.assertFalse(response.dry_run)
            self.assertEqual(response.candidate_jobs, 1)
            self.assertEqual(response.deleted_jobs, 1)
            self.assertEqual(response.deleted_bytes, 15)
            self.assertEqual(response.failed_jobs, 0)
            self.assertIsNone(get_job(db_path, "eligible"))
            self.assertIsNotNone(get_job(db_path, "recent"))
            self.assertIsNotNone(get_job(db_path, "popular"))
            self.assertIsNotNone(get_job(db_path, "queued"))
            self.assertFalse((storage_root / "audio" / "eligible.m4a").exists())
            self.assertFalse((storage_root / "analysis" / "eligible.json").exists())
            self.assertFalse((storage_root / "logs" / "eligible.log").exists())
            self.assertTrue((storage_root / "audio" / "recent.m4a").exists())
            self.assertEqual(_job_count(db_path), 3)
            self.assertEqual(_source_count(db_path), 3)

    def test_missing_files_do_not_fail_deletion(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "missing-files", write_files=False)

            response = execute_cleanup(db_path, storage_root)

            self.assertEqual(response.deleted_jobs, 1)
            self.assertEqual(response.deleted_bytes, 0)
            self.assertEqual(response.failed_jobs, 0)
            self.assertIsNone(get_job(db_path, "missing-files"))

    def test_unlink_failure_records_error_and_keeps_db_row(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "fail")
            original_unlink = Path.unlink

            def fail_first_audio(path: Path, *args, **kwargs):
                if path.name == "fail.m4a":
                    raise OSError("cannot unlink")
                return original_unlink(path, *args, **kwargs)

            with patch.object(Path, "unlink", fail_first_audio):
                response = execute_cleanup(db_path, storage_root)

            self.assertEqual(response.deleted_jobs, 0)
            self.assertEqual(response.failed_jobs, 1)
            self.assertEqual(response.errors[0].job_id, "fail")
            self.assertIn("cannot unlink", response.errors[0].error)
            self.assertIsNotNone(get_job(db_path, "fail"))
            self.assertTrue((storage_root / "audio" / "fail.m4a").exists())

    def test_iso_timestamp_with_t_separator_is_compared_by_julianday(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "old-iso", updated_at=OLD_UPDATED_AT)
            _make_job(db_path, storage_root, "recent-iso", updated_at=RECENT_UPDATED_AT)

            response = build_cleanup_preview(db_path, storage_root)

        self.assertEqual(response.candidate_jobs, 1)
        self.assertEqual(response.sample[0].job_id, "old-iso")


if __name__ == "__main__":
    unittest.main()
