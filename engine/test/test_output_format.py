from __future__ import annotations

import json
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


def _install_madmom_stub() -> None:
    module = types.ModuleType("madmom_beats_lite")

    class ExtractionConfig:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    def extract_beats(*args: object, **kwargs: object) -> object:
        raise AssertionError("test should patch analyze_audio")

    module.ExtractionConfig = ExtractionConfig
    module.extract_beats = extract_beats
    sys.modules.setdefault("madmom_beats_lite", module)


_install_madmom_stub()

from app.main import main  # noqa: E402


class OutputFormatTests(unittest.TestCase):
    """The engine CLI is the single writer of analysis JSON; its output must be
    byte-for-byte compact (sorted keys, no separator whitespace) so every stored
    file is uniform. See the removed worker `apply_track_metadata` re-dump, which
    used default separators and produced spaced files."""

    def _analysis(self) -> dict:
        return {
            "engine_version": 3,
            "track": {"duration": 12.5, "title": "orig", "artist": "orig"},
            "beats": [0.0, 0.5, 1.0],
        }

    def test_cli_writes_compact_sorted_json(self) -> None:
        data = self._analysis()
        with TemporaryDirectory() as tmp:
            out = Path(tmp) / "result.json"
            with (
                patch("sys.argv", ["python -m app.main", "song.wav", "-o", str(out)]),
                patch("app.analysis.analyze_audio", return_value=data),
            ):
                main()
            written = out.read_text(encoding="utf-8")

        expected = json.dumps(data, sort_keys=True, separators=(",", ":"))
        self.assertEqual(written, expected)
        self.assertIn('"engine_version":3', written)
        self.assertNotIn('"engine_version": 3', written)

    def test_cli_embeds_metadata_without_reserializing_spaced(self) -> None:
        data = self._analysis()
        with TemporaryDirectory() as tmp:
            out = Path(tmp) / "result.json"
            with (
                patch(
                    "sys.argv",
                    ["python -m app.main", "song.wav", "-o", str(out),
                     "--title", "New Title", "--artist", "New Artist"],
                ),
                patch("app.analysis.analyze_audio", return_value=data),
            ):
                main()
            written = out.read_text(encoding="utf-8")

        reloaded = json.loads(written)
        self.assertEqual(reloaded["track"]["title"], "New Title")
        self.assertEqual(reloaded["track"]["artist"], "New Artist")
        # Metadata embedding must still yield compact output, not the legacy
        # spaced form.
        self.assertNotIn(", ", written)
        self.assertNotIn(": ", written)


if __name__ == "__main__":
    unittest.main()
