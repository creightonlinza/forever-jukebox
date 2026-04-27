from __future__ import annotations

import unittest

from api.routes.jobs_runtime import (
    ERROR_CODE_NO_BEATS_DETECTED,
    ERROR_NO_BEATS_DETECTED,
    error_code_for,
    failure_code_for,
    normalize_job_error,
)
from worker.worker import _extract_engine_error


class NoBeatsErrorTests(unittest.TestCase):
    def test_worker_prefers_specific_engine_error_line(self) -> None:
        output = [
            "PROGRESS:85:beats\n",
            "ERROR: No beats or downbeats were detected in this audio. "
            "The track may be silent or lack a clear rhythm.\n",
        ]

        self.assertEqual(_extract_engine_error(output), ERROR_NO_BEATS_DETECTED)

    def test_no_beats_error_is_normalized_with_code(self) -> None:
        raw = "ERROR: No beats or downbeats were detected in this audio."

        self.assertEqual(normalize_job_error(raw), ERROR_NO_BEATS_DETECTED)
        self.assertEqual(error_code_for(raw), ERROR_CODE_NO_BEATS_DETECTED)
        self.assertEqual(failure_code_for(raw), ERROR_CODE_NO_BEATS_DETECTED)

    def test_legacy_empty_extraction_error_maps_to_no_beats(self) -> None:
        raw = "RuntimeError: madmom-beats-lite extraction empty"

        self.assertEqual(normalize_job_error(raw), ERROR_NO_BEATS_DETECTED)


if __name__ == "__main__":
    unittest.main()
