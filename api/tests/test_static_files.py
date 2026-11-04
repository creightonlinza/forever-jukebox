from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from api.main import _static_file


class StaticFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dist = Path(self._tmp.name)
        (self.dist / "assets").mkdir()

    def _write(self, relative: str) -> Path:
        path = self.dist / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x", encoding="utf-8")
        return path

    def test_fixed_name_files_are_revalidated(self) -> None:
        for relative in ("index.html", "madmom/worker.js", "favicon.png"):
            with self.subTest(relative=relative):
                response = _static_file(self._write(relative), self.dist)
                self.assertEqual(response.headers["cache-control"], "no-cache")

    def test_hashed_assets_keep_default_caching(self) -> None:
        response = _static_file(self._write("assets/index-abc123.js"), self.dist)

        self.assertNotIn("cache-control", response.headers)
