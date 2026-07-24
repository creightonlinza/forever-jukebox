from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from api.db import get_job, init_db
from api.utils import analysis_path_for, audio_path_for


def _job_columns(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        return {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}


def _applied_migrations(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        return {row[0] for row in conn.execute("SELECT id FROM schema_migrations")}


def _build_0001_schema_with_paths(db_path: Path) -> None:
    """Recreate the pre-0002 schema: jobs carrying input_path/output_path."""
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE sources (
            id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_id TEXT, source_url TEXT,
            track_title TEXT, track_artist TEXT, play_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY, source_ref TEXT NOT NULL, status TEXT NOT NULL,
            input_path TEXT NOT NULL, output_path TEXT NOT NULL, error TEXT,
            progress INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(source_ref) REFERENCES sources(id)
        )
        """
    )
    conn.execute("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    conn.execute(
        "INSERT INTO sources VALUES ('yt_abc','youtube','abc',NULL,'Song','Artist',5,'t1','t2')"
    )
    conn.execute(
        "INSERT INTO jobs VALUES "
        "('job1','yt_abc','complete','audio/job1.m4a','analysis/job1.json',NULL,100,'t1','t2')"
    )
    conn.execute("INSERT INTO schema_migrations VALUES ('0001_sources_jobs_unification','t0')")
    conn.commit()
    conn.close()


class DropJobPathsMigrationTests(unittest.TestCase):
    def test_drops_path_columns_and_preserves_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            _build_0001_schema_with_paths(db_path)

            init_db(db_path)

            cols = _job_columns(db_path)
            self.assertNotIn("input_path", cols)
            self.assertNotIn("output_path", cols)
            self.assertIn("0002_drop_job_paths", _applied_migrations(db_path))

            job = get_job(db_path, "job1")
            self.assertIsNotNone(job)
            self.assertEqual(job.status, "complete")
            self.assertEqual(job.play_count, 5)
            self.assertEqual(job.source_provider, "youtube")

    def test_migrated_complete_job_audio_still_resolvable_by_id(self) -> None:
        # End-to-end seam: after input_path/output_path are dropped, a complete
        # job whose artifacts sit on disk as audio/<id>.<ext> and
        # analysis/<id>.json must still be located purely from the job id.
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            db_path = root / "jobs.db"
            storage_root = root / "storage"
            (storage_root / "audio").mkdir(parents=True)
            (storage_root / "analysis").mkdir(parents=True)
            (storage_root / "audio" / "job1.m4a").write_bytes(b"audio")
            (storage_root / "analysis" / "job1.json").write_text("{}")
            _build_0001_schema_with_paths(db_path)

            init_db(db_path)

            job = get_job(db_path, "job1")
            self.assertIsNotNone(job)
            self.assertEqual(job.status, "complete")

            resolved_audio = audio_path_for(storage_root, job.id)
            self.assertIsNotNone(resolved_audio)
            self.assertEqual(resolved_audio.name, "job1.m4a")
            self.assertTrue(resolved_audio.is_file())

            resolved_analysis = analysis_path_for(storage_root, job.id)
            self.assertTrue(resolved_analysis.is_file())

    def test_recreates_job_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            _build_0001_schema_with_paths(db_path)

            init_db(db_path)

            with sqlite3.connect(db_path) as conn:
                indexes = {
                    row[0]
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='jobs'"
                    )
                }
            self.assertIn("idx_jobs_status_created", indexes)
            self.assertIn("idx_jobs_source_ref_created", indexes)

    def test_is_idempotent_on_rerun(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            _build_0001_schema_with_paths(db_path)

            init_db(db_path)
            # A second run must be a no-op and must not error or duplicate rows.
            init_db(db_path)

            self.assertNotIn("input_path", _job_columns(db_path))
            with sqlite3.connect(db_path) as conn:
                job_rows = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            self.assertEqual(job_rows, 1)

    def test_fresh_db_has_no_path_columns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"

            init_db(db_path)

            cols = _job_columns(db_path)
            self.assertNotIn("input_path", cols)
            self.assertNotIn("output_path", cols)
            self.assertIn("0002_drop_job_paths", _applied_migrations(db_path))

    def test_orphan_job_row_does_not_abort_migration(self) -> None:
        # A job whose source_ref is missing from sources must not abort the
        # rebuild: foreign keys are disabled for the migration transaction.
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            _build_0001_schema_with_paths(db_path)
            with sqlite3.connect(db_path) as conn:
                conn.execute("PRAGMA foreign_keys = OFF")
                conn.execute(
                    "INSERT INTO jobs VALUES "
                    "('orphan','GHOST','failed','audio/orphan.m4a','analysis/orphan.json',NULL,0,'t1','t2')"
                )
                conn.commit()

            init_db(db_path)

            self.assertNotIn("input_path", _job_columns(db_path))
            with sqlite3.connect(db_path) as conn:
                rows = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
                orphan = conn.execute(
                    "SELECT source_ref FROM jobs WHERE id = 'orphan'"
                ).fetchone()
            self.assertEqual(rows, 2)
            # The orphan row survives the rebuild verbatim (get_job can't return
            # it because it INNER JOINs sources, but the row is preserved).
            self.assertEqual(orphan[0], "GHOST")

    def test_concurrent_migrations_are_serialized(self) -> None:
        # The API and worker both run init_db() on startup as separate
        # processes; concurrent runs must not corrupt the rebuild or error.
        import threading

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            _build_0001_schema_with_paths(db_path)

            errors: list[str] = []

            def migrate() -> None:
                try:
                    init_db(db_path)
                except Exception as exc:  # noqa: BLE001 - collect for assertion
                    errors.append(repr(exc))

            threads = [threading.Thread(target=migrate) for _ in range(6)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            self.assertEqual(errors, [])
            self.assertNotIn("input_path", _job_columns(db_path))
            self.assertIn("0002_drop_job_paths", _applied_migrations(db_path))
            with sqlite3.connect(db_path) as conn:
                rows = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            self.assertEqual(rows, 1)


if __name__ == "__main__":
    unittest.main()
