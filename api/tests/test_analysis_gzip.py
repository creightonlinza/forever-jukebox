from __future__ import annotations

import gzip
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from api.routes import jobs
from api.utils import analysis_path_for, read_analysis_json, resolve_analysis_path
from scripts.gzip_existing_analysis import convert_directory
from worker.worker import compress_analysis


def _write_plain(root: Path, job_id: str, payload: dict) -> Path:
    path = analysis_path_for(root, job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _write_gz(root: Path, job_id: str, payload: dict) -> Path:
    plain = analysis_path_for(root, job_id)
    plain.parent.mkdir(parents=True, exist_ok=True)
    gz_path = plain.with_name(plain.name + ".gz")
    with gzip.open(gz_path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle)
    return gz_path


class ResolveAnalysisPathTests(unittest.TestCase):
    def test_prefers_gz_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_plain(root, "job1", {"a": 1})
            _write_gz(root, "job1", {"a": 1})

            self.assertEqual(resolve_analysis_path(root, "job1").name, "job1.json.gz")

    def test_falls_back_to_plain_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_plain(root, "job1", {"a": 1})

            self.assertEqual(resolve_analysis_path(root, "job1").name, "job1.json")

    def test_returns_plain_path_when_neither_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            resolved = resolve_analysis_path(root, "missing")

            self.assertEqual(resolved.name, "missing.json")
            self.assertFalse(resolved.exists())


class ReadAnalysisJsonTests(unittest.TestCase):
    def test_reads_plain_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = _write_plain(Path(temp_dir), "job1", {"track": {"title": "Song"}})

            self.assertEqual(read_analysis_json(path), {"track": {"title": "Song"}})

    def test_reads_gzipped_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = _write_gz(Path(temp_dir), "job1", {"track": {"title": "Song"}})

            self.assertEqual(read_analysis_json(path), {"track": {"title": "Song"}})


class CompressAnalysisTests(unittest.TestCase):
    def test_replaces_plain_file_with_gz(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plain = _write_plain(root, "job1", {"beats": [1, 2, 3]})

            compress_analysis(plain)

            gz_path = plain.with_name(plain.name + ".gz")
            self.assertFalse(plain.exists())
            self.assertTrue(gz_path.exists())
            self.assertEqual(read_analysis_json(gz_path), {"beats": [1, 2, 3]})
            self.assertEqual(list(plain.parent.iterdir()), [gz_path])

    def test_overwrites_stale_gz_from_previous_run(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gz(root, "job1", {"stale": True})
            plain = _write_plain(root, "job1", {"fresh": True})

            compress_analysis(plain)

            self.assertEqual(
                read_analysis_json(resolve_analysis_path(root, "job1")),
                {"fresh": True},
            )


class AutoRepairGzTests(unittest.TestCase):
    def test_gz_only_analysis_is_not_treated_as_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_gz(root, "job1", {"track": {}})
            job = SimpleNamespace(id="job1", status="complete", source_id=None)

            with patch.object(jobs, "STORAGE_ROOT", root):
                self.assertFalse(jobs._should_attempt_auto_repair(job))

    def test_missing_analysis_still_triggers_repair(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            job = SimpleNamespace(id="job1", status="complete", source_id=None)

            with patch.object(jobs, "STORAGE_ROOT", root):
                self.assertTrue(jobs._should_attempt_auto_repair(job))


class ConversionScriptTests(unittest.TestCase):
    def test_converts_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _write_plain(root, "job1", {"a": 1})
            _write_plain(root, "job2", {"b": 2})
            analysis_dir = root / "analysis"

            first = convert_directory(analysis_dir)
            second = convert_directory(analysis_dir)

            self.assertEqual(first.converted, 2)
            self.assertEqual(first.errors, [])
            self.assertGreater(first.bytes_before, 0)
            self.assertEqual(second.converted, 0)
            self.assertEqual(second.errors, [])
            self.assertEqual(
                sorted(path.name for path in analysis_dir.iterdir()),
                ["job1.json.gz", "job2.json.gz"],
            )
            self.assertEqual(read_analysis_json(analysis_dir / "job1.json.gz"), {"a": 1})

    def test_leaves_invalid_json_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            analysis_dir = root / "analysis"
            analysis_dir.mkdir(parents=True)
            bad_path = analysis_dir / "bad.json"
            bad_path.write_text("not json {", encoding="utf-8")

            summary = convert_directory(analysis_dir)

            self.assertEqual(summary.converted, 0)
            self.assertEqual(len(summary.errors), 1)
            self.assertTrue(bad_path.exists())
            self.assertEqual(sorted(path.name for path in analysis_dir.iterdir()), ["bad.json"])

    def test_skips_files_with_existing_gz_sibling(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plain = _write_plain(root, "job1", {"new": True})
            _write_gz(root, "job1", {"old": True})

            summary = convert_directory(root / "analysis")

            self.assertEqual(summary.converted, 0)
            self.assertEqual(summary.skipped, 1)
            self.assertTrue(plain.exists())


if __name__ == "__main__":
    unittest.main()
