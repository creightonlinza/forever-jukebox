from __future__ import annotations

import unittest

from api.routes.jobs_runtime import (
    ERROR_CODE_NO_BEATS_DETECTED,
    ERROR_CODE_YOUTUBE_LIVE,
    ERROR_NO_BEATS_DETECTED,
    ERROR_YOUTUBE_LIVE,
    error_code_for,
    failure_code_for,
    is_retryable_download_error,
    normalize_job_error,
    source_info_is_live,
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

    def test_age_restricted_download_failure_is_permanent(self) -> None:
        raw = "ERROR: [youtube] abc123def45: Sign in to confirm your age."

        self.assertFalse(is_retryable_download_error(raw))
        self.assertEqual(failure_code_for(raw), "youtube_age_restricted")
        self.assertEqual(error_code_for(raw), "youtube_age_restricted")

    def test_retryable_download_failures_are_identified_by_error(self) -> None:
        samples = [
            "ERROR: [youtube] Y8TcF-r7TaE: Premieres in 3 hours",
            "ERROR: \r[download] Got error: 2097136 bytes read, 2165663 more expected",
            "ERROR: HTTP Error 403: Forbidden",
            "ERROR: Sign in to confirm you're not a bot",
            "ERROR: Unable to download video data.",
        ]

        for raw in samples:
            with self.subTest(raw=raw):
                self.assertTrue(is_retryable_download_error(raw))

    def test_live_youtube_error_is_permanent(self) -> None:
        self.assertEqual(normalize_job_error(ERROR_YOUTUBE_LIVE), ERROR_YOUTUBE_LIVE)
        self.assertEqual(error_code_for(ERROR_YOUTUBE_LIVE), ERROR_CODE_YOUTUBE_LIVE)
        self.assertEqual(failure_code_for(ERROR_YOUTUBE_LIVE), ERROR_CODE_YOUTUBE_LIVE)
        self.assertFalse(is_retryable_download_error(ERROR_YOUTUBE_LIVE))

    def test_live_status_metadata_detection(self) -> None:
        self.assertTrue(source_info_is_live({"live_status": "is_live"}))
        self.assertTrue(source_info_is_live({"is_live": True}))
        self.assertFalse(source_info_is_live({"live_status": "was_live", "was_live": True}))
        self.assertFalse(source_info_is_live({"live_status": "is_upcoming"}))


if __name__ == "__main__":
    unittest.main()
