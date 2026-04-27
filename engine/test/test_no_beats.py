from __future__ import annotations

import sys
import types
import unittest
from io import StringIO
from unittest.mock import patch

import numpy as np


def _install_madmom_stub() -> None:
    module = types.ModuleType("madmom_beats_lite")

    class ExtractionConfig:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    def extract_beats(*args: object, **kwargs: object) -> object:
        raise AssertionError("test should patch extract_beats_lite")

    module.ExtractionConfig = ExtractionConfig
    module.extract_beats = extract_beats
    sys.modules.setdefault("madmom_beats_lite", module)


_install_madmom_stub()

from app import beats as beats_module  # noqa: E402
from app.analysis import (  # noqa: E402
    NO_BEATS_DETECTED_MESSAGE,
    NoBeatsDetectedError,
    analyze_audio,
)
from app.main import main  # noqa: E402


class EmptyBeatResult:
    beat_times: list[float] = []
    beat_numbers: list[int] = []
    beat_confidences: list[float] = []


class NoBeatsTests(unittest.TestCase):
    def test_extract_beats_returns_empty_lists_for_empty_extractor_result(self) -> None:
        audio = np.zeros(100, dtype=np.float32)

        with patch.object(beats_module, "extract_beats_lite", return_value=EmptyBeatResult()):
            self.assertEqual(beats_module.extract_beats(audio, 100), ([], [], []))

    def test_analyze_audio_raises_specific_error_when_no_beats_are_detected(self) -> None:
        audio = np.zeros(100, dtype=np.float32)

        with (
            patch("app.analysis.decode_audio", return_value=(audio, 100)),
            patch("app.analysis.extract_beats", return_value=([], [], [])),
        ):
            with self.assertRaises(NoBeatsDetectedError) as raised:
                analyze_audio("silent.wav")

        self.assertEqual(str(raised.exception), NO_BEATS_DETECTED_MESSAGE)

    def test_cli_prints_expected_error_without_traceback(self) -> None:
        stderr = StringIO()

        with (
            patch("sys.argv", ["python -m app.main", "silent.wav"]),
            patch(
                "app.analysis.analyze_audio",
                side_effect=NoBeatsDetectedError(NO_BEATS_DETECTED_MESSAGE),
            ),
            patch("sys.stderr", stderr),
        ):
            with self.assertRaises(SystemExit) as raised:
                main()

        self.assertEqual(raised.exception.code, 1)
        self.assertEqual(stderr.getvalue(), f"ERROR: {NO_BEATS_DETECTED_MESSAGE}\n")

    def test_cli_prints_unexpected_analysis_error_without_traceback(self) -> None:
        stderr = StringIO()

        with (
            patch("sys.argv", ["python -m app.main", "broken.wav"]),
            patch("app.analysis.analyze_audio", side_effect=RuntimeError("ffmpeg failed")),
            patch("sys.stderr", stderr),
        ):
            with self.assertRaises(SystemExit) as raised:
                main()

        self.assertEqual(raised.exception.code, 1)
        self.assertEqual(stderr.getvalue(), "ERROR: Analysis failed: ffmpeg failed\n")


if __name__ == "__main__":
    unittest.main()
