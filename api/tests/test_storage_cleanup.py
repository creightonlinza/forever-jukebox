from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from api import db as db_module
from api.db import create_job, get_job, init_db
from api import favorites_db as favorites_module
from api.favorites_db import init_favorites_db, load_favorites, save_favorites
from api.models import StorageCleanupRequest
from api.routes import admin as admin_routes
from api import storage_cleanup as storage_cleanup_module
from api.storage_cleanup import CLEANUP_POLICY_DAYS, build_cleanup_preview, execute_cleanup


OLD_UPDATED_AT = "2000-01-01T00:00:00.000000+00:00"
MID_WINDOW_AGO = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()
# Inside the dormancy window at any policy value, but past the zero-play grace.
INSIDE_WINDOW = (datetime.now(timezone.utc) - timedelta(days=CLEANUP_POLICY_DAYS // 2)).isoformat()
THREE_DAYS_AGO = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
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


def _source_url_for(provider: str, job_id: str) -> str | None:
    """A URL on the provider's own host, since the provider is derived from it."""
    hosts = {
        "youtube": f"https://www.youtube.com/watch?v=source-{job_id}",
        "soundcloud": f"https://soundcloud.com/artist/{job_id}",
        "bandcamp": f"https://artist.bandcamp.com/track/{job_id}",
    }
    return hosts.get(provider)


def _make_job(
    db_path: Path,
    storage_root: Path,
    job_id: str,
    *,
    status: str = "complete",
    play_count: int = 1,
    updated_at: str = OLD_UPDATED_AT,
    provider: str = "youtube",
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
        status=status,
        track_title=title or f"Track {job_id}",
        track_artist="Artist",
        source_id=f"source-{job_id}",
        source_provider=provider,
        source_url=_source_url_for(provider, job_id),
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
            self.assertEqual(response.days, 365)
            self.assertEqual(response.zero_play_days, 7)
            self.assertEqual(response.candidate_jobs, 1)
            self.assertEqual(response.candidate_bytes, 15)
            self.assertEqual(_job_count(db_path), 1)
            self.assertTrue((storage_root / "audio" / "old-job.m4a").exists())

    def test_preview_lists_every_candidate_oldest_first(self) -> None:
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
        self.assertEqual(len(response.candidates), 12)
        self.assertEqual([item.job_id for item in response.candidates], [f"job-{index:02d}" for index in range(12)])

    def test_every_provider_is_a_candidate(self) -> None:
        providers = ("youtube", "upload", "soundcloud", "bandcamp")
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            for provider in providers:
                _make_job(db_path, storage_root, "old-%s" % provider, provider=provider)

            preview = build_cleanup_preview(db_path, storage_root)
            self.assertEqual(preview.candidate_jobs, len(providers))

            response = execute_cleanup(db_path, storage_root)
            self.assertEqual(response.deleted_jobs, len(providers))
            for provider in providers:
                self.assertIsNone(get_job(db_path, "old-%s" % provider))
                self.assertFalse((storage_root / "audio" / ("old-%s.m4a" % provider)).exists())

    def test_never_opened_tracks_are_candidates_after_the_grace_period(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            # Inside the full window, so only the zero-play rule can match.
            _make_job(db_path, storage_root, "never-opened", play_count=0, updated_at=INSIDE_WINDOW)
            _make_job(db_path, storage_root, "opened-once", play_count=1, updated_at=INSIDE_WINDOW)

            preview = build_cleanup_preview(db_path, storage_root)
            self.assertEqual(preview.candidate_jobs, 1)
            self.assertEqual(preview.candidates[0].job_id, "never-opened")

            response = execute_cleanup(db_path, storage_root)
            self.assertEqual(response.deleted_jobs, 1)
            self.assertIsNone(get_job(db_path, "never-opened"))
            self.assertIsNotNone(get_job(db_path, "opened-once"))
            self.assertFalse((storage_root / "audio" / "never-opened.m4a").exists())
            self.assertTrue((storage_root / "audio" / "opened-once.m4a").exists())

    def test_never_opened_tracks_are_spared_during_the_grace_period(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "just-added", play_count=0, updated_at=THREE_DAYS_AGO)

            preview = build_cleanup_preview(db_path, storage_root)
            self.assertEqual(preview.candidate_jobs, 0)

            response = execute_cleanup(db_path, storage_root)
            self.assertEqual(response.deleted_jobs, 0)
            self.assertIsNotNone(get_job(db_path, "just-added"))
            self.assertTrue((storage_root / "audio" / "just-added.m4a").exists())

    def test_request_default_window_matches_the_policy_constant(self) -> None:
        self.assertEqual(StorageCleanupRequest().days, CLEANUP_POLICY_DAYS)

    def test_request_rejects_windows_outside_the_allowed_set(self) -> None:
        for days in (18, 90, 400, 0, -270):
            with self.subTest(days=days):
                with self.assertRaises(ValidationError):
                    StorageCleanupRequest(days=days)

    def test_window_selects_which_tracks_are_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            # Dormant 200 days: inside 270/365, past 180.
            _make_job(db_path, storage_root, "mid", updated_at=MID_WINDOW_AGO)

            for days, expected in ((180, 1), (270, 0), (365, 0)):
                with self.subTest(days=days):
                    preview = build_cleanup_preview(db_path, storage_root, days)
                    self.assertEqual(preview.candidate_jobs, expected)
                    self.assertEqual(preview.days, days)

            # The pre-delete re-check must use the same window as the scan.
            spared = execute_cleanup(db_path, storage_root, 365)
            self.assertEqual(spared.deleted_jobs, 0)
            self.assertTrue((storage_root / "audio" / "mid.m4a").exists())

            swept = execute_cleanup(db_path, storage_root, 180)
            self.assertEqual(swept.deleted_jobs, 1)
            self.assertEqual(swept.days, 180)
            self.assertFalse((storage_root / "audio" / "mid.m4a").exists())
            self.assertIsNone(get_job(db_path, "mid"))

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

    def test_execute_deletes_artifacts_and_rows_regardless_of_play_count(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "eligible")
            _make_job(db_path, storage_root, "recent", updated_at=RECENT_UPDATED_AT)
            # Stale but high play count: still cleared, play_count no longer gates.
            _make_job(db_path, storage_root, "popular", play_count=3)
            _make_job(db_path, storage_root, "queued", status="queued")

            response = execute_cleanup(db_path, storage_root)

            self.assertFalse(response.dry_run)
            self.assertEqual(response.candidate_jobs, 2)
            self.assertEqual(response.deleted_jobs, 2)
            self.assertEqual(response.freed_bytes, 30)
            self.assertEqual(response.failed_jobs, 0)
            self.assertIsNone(get_job(db_path, "eligible"))
            self.assertIsNone(get_job(db_path, "popular"))
            self.assertIsNotNone(get_job(db_path, "recent"))
            self.assertIsNotNone(get_job(db_path, "queued"))
            self.assertFalse((storage_root / "audio" / "eligible.m4a").exists())
            self.assertFalse((storage_root / "analysis" / "eligible.json").exists())
            self.assertFalse((storage_root / "logs" / "eligible.log").exists())
            self.assertTrue((storage_root / "audio" / "recent.m4a").exists())
            # The two deleted jobs take their source rows with them.
            self.assertEqual(_job_count(db_path), 2)
            self.assertEqual(_source_count(db_path), 2)

    def test_rows_whose_artifacts_are_already_gone_are_still_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            storage_root = Path(temp_dir) / "storage"
            init_db(db_path)
            _make_job(db_path, storage_root, "missing-files", write_files=False)

            preview = build_cleanup_preview(db_path, storage_root)
            self.assertEqual(preview.candidate_jobs, 1)
            self.assertEqual(preview.candidate_bytes, 0)

            response = execute_cleanup(db_path, storage_root)

            self.assertEqual(response.deleted_jobs, 1)
            self.assertEqual(response.freed_bytes, 0)
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
        self.assertEqual(response.candidates[0].job_id, "old-iso")


class FavoritesPruneTests(unittest.TestCase):
    """Cleanup drops favorite entries whose job is gone."""

    def _setup(self, temp_dir: str) -> tuple[Path, Path, Path]:
        db_path = Path(temp_dir) / "jobs.db"
        storage_root = Path(temp_dir) / "storage"
        favorites_path = Path(temp_dir) / "favorites.db"
        init_db(db_path)
        init_favorites_db(favorites_path)
        return db_path, storage_root, favorites_path

    def _favorite(self, job_id: str) -> dict:
        return {"uniqueSongId": job_id, "title": "T", "artist": "A", "sourceType": "youtube"}

    def test_cleanup_prunes_favorites_for_jobs_it_deletes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "doomed")
            _make_job(db_path, storage_root, "kept", updated_at=RECENT_UPDATED_AT)
            save_favorites(
                favorites_path,
                "code-a",
                [self._favorite("doomed"), self._favorite("kept")],
            )

            response = execute_cleanup(db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path)

            self.assertEqual(response.deleted_jobs, 1)
            self.assertEqual(response.pruned_favorites, 1)
            remaining = load_favorites(favorites_path, "code-a")
            self.assertEqual([item["uniqueSongId"] for item in remaining], ["kept"])

    def test_cleanup_prunes_favorites_orphaned_by_earlier_admin_deletes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "live", updated_at=RECENT_UPDATED_AT)
            # "gone" has no job row at all, as an admin delete would leave it.
            save_favorites(
                favorites_path,
                "code-a",
                [self._favorite("gone"), self._favorite("live")],
            )

            response = execute_cleanup(db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path)

            self.assertEqual(response.deleted_jobs, 0)
            self.assertEqual(response.pruned_favorites, 1)
            remaining = load_favorites(favorites_path, "code-a")
            self.assertEqual([item["uniqueSongId"] for item in remaining], ["live"])

    def test_favorites_on_failed_jobs_are_kept(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "broken", status="failed")
            save_favorites(favorites_path, "code-a", [self._favorite("broken")])

            response = execute_cleanup(db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path)

            self.assertEqual(response.pruned_favorites, 0)
            self.assertEqual(len(load_favorites(favorites_path, "code-a")), 1)

    def test_dry_run_reports_orphans_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "doomed")
            save_favorites(
                favorites_path,
                "code-a",
                [self._favorite("doomed"), self._favorite("gone")],
            )

            preview = build_cleanup_preview(
                db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path
            )

            # The candidate plus the already-orphaned entry.
            self.assertEqual(preview.orphaned_favorites, 2)
            self.assertEqual(preview.pruned_favorites, 0)
            self.assertEqual(len(load_favorites(favorites_path, "code-a")), 2)

    def test_entries_without_a_job_id_are_left_alone(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "live", updated_at=RECENT_UPDATED_AT)
            save_favorites(favorites_path, "code-a", [{"title": "No id", "artist": "A"}])

            response = execute_cleanup(db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path)

            self.assertEqual(response.pruned_favorites, 0)
            self.assertEqual(len(load_favorites(favorites_path, "code-a")), 1)

    def test_an_empty_job_table_prunes_nothing(self) -> None:
        """A read that yields no jobs must not empty every favorites list."""
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            save_favorites(favorites_path, "code-a", [self._favorite("orphan")])

            response = execute_cleanup(db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path)

            self.assertEqual(response.pruned_favorites, 0)
            self.assertEqual(len(load_favorites(favorites_path, "code-a")), 1)

    def test_a_missing_favorites_db_is_not_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, _ = self._setup(temp_dir)
            _make_job(db_path, storage_root, "doomed")

            response = execute_cleanup(
                db_path, storage_root, CLEANUP_POLICY_DAYS, Path(temp_dir) / "absent.db"
            )

            self.assertEqual(response.deleted_jobs, 1)
            self.assertEqual(response.pruned_favorites, 0)

    def test_a_favorites_failure_still_reports_the_deletions(self) -> None:
        """The deletions are already committed, so the report must survive."""
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "doomed")
            save_favorites(favorites_path, "code-a", [self._favorite("gone")])

            with patch.object(
                storage_cleanup_module,
                "prune_orphaned_favorites",
                side_effect=OSError("database is locked"),
            ):
                response = execute_cleanup(
                    db_path, storage_root, CLEANUP_POLICY_DAYS, favorites_path
                )

            self.assertEqual(response.deleted_jobs, 1)
            self.assertIsNone(get_job(db_path, "doomed"))
            self.assertEqual(response.pruned_favorites, 0)
            # A favorites failure is not a failed job.
            self.assertEqual(response.failed_jobs, 0)
            self.assertEqual(len(response.errors), 1)
            self.assertEqual(response.errors[0].job_id, "favorites")
            self.assertIn("database is locked", response.errors[0].error)

    def test_a_prune_failure_leaves_every_list_untouched(self) -> None:
        """One write transaction, so a mid-prune failure rolls the rest back."""
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path, storage_root, favorites_path = self._setup(temp_dir)
            _make_job(db_path, storage_root, "live", updated_at=RECENT_UPDATED_AT)
            for code in ("code-a", "code-b"):
                save_favorites(
                    favorites_path, code, [self._favorite("gone"), self._favorite("live")]
                )

            real_dumps = favorites_module.json.dumps
            calls = {"n": 0}

            def fail_second(*args, **kwargs):
                calls["n"] += 1
                if calls["n"] == 2:
                    raise ValueError("encode blew up")
                return real_dumps(*args, **kwargs)

            # Called directly: execute_cleanup deliberately swallows prune errors.
            with patch.object(favorites_module.json, "dumps", fail_second):
                with self.assertRaises(ValueError):
                    favorites_module.prune_orphaned_favorites(favorites_path, {"live"})

            # The first row's UPDATE must not have survived the rollback.
            for code in ("code-a", "code-b"):
                remaining = load_favorites(favorites_path, code)
                self.assertEqual(
                    [item["uniqueSongId"] for item in remaining], ["gone", "live"]
                )

if __name__ == "__main__":
    unittest.main()
