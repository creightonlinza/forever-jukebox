from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from api.utils import audio_path_for


class AudioPathForTests(unittest.TestCase):
    def _audio_dir(self, root: Path) -> Path:
        audio = root / "audio"
        audio.mkdir(parents=True, exist_ok=True)
        return audio

    def test_returns_finished_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (self._audio_dir(root) / "job1.m4a").write_bytes(b"x")

            result = audio_path_for(root, "job1")

            self.assertIsNotNone(result)
            self.assertEqual(result.name, "job1.m4a")

    def test_returns_none_when_only_transient_files_present(self) -> None:
        # Mid-download: only yt-dlp partial + DASH fragment files exist.
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = self._audio_dir(root)
            (audio / "job1.webm.part").write_bytes(b"x")
            (audio / "job1.f251.webm").write_bytes(b"x")
            (audio / "job1.webm.ytdl").write_bytes(b"x")

            self.assertIsNone(audio_path_for(root, "job1"))

    def test_ignores_transient_files_when_finished_file_present(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = self._audio_dir(root)
            (audio / "job1.webm.part").write_bytes(b"x")
            (audio / "job1.f140.m4a").write_bytes(b"x")
            (audio / "job1.m4a").write_bytes(b"x")

            result = audio_path_for(root, "job1")

            self.assertEqual(result.name, "job1.m4a")

    def test_returns_none_when_no_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._audio_dir(root)

            self.assertIsNone(audio_path_for(root, "missing"))


if __name__ == "__main__":
    unittest.main()
