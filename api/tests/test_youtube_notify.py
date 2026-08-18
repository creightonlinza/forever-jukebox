from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from api import db as db_module
from api.db import (
    claim_notify_state,
    create_job,
    get_notify_state,
    init_db,
    set_job_status,
)
from api.routes import jobs_runtime as jobs_runtime_module
from api.routes.jobs_runtime import (
    NOTIFY_LAST_SENT_KEY,
    maybe_notify_youtube_failures,
    youtube_block_signal,
)


def _utc_iso(offset: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + offset).isoformat()


class YoutubeBlockSignalTests(unittest.TestCase):
    def test_labels_for_block_errors(self) -> None:
        cases = {
            "ERROR: unable to download video data: HTTP Error 403: Forbidden": "403",
            "ERROR: Sign in to confirm you're not a bot": "bot-check",
            "ERROR: HTTP Error 429: Too Many Requests": "429",
            "ERROR: This content isn't available, try again later": "blocked",
            "ERROR: Connection timed out": "network",
            "ERROR: Connection reset by peer": "network",
        }
        for raw, expected in cases.items():
            self.assertEqual(youtube_block_signal(raw), expected, raw)

    def test_non_block_errors_return_none(self) -> None:
        cases = [
            None,
            "",
            "ERROR: Sign in to confirm your age",
            "ERROR: This video is age-restricted",
            "ERROR: Video unavailable",
            "ERROR: Something went wrong.",
        ]
        for raw in cases:
            self.assertIsNone(youtube_block_signal(raw), raw)


class MaybeNotifyYoutubeFailuresTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.db_path = Path(temp_dir.name) / "jobs.db"
        init_db(self.db_path)

        env_patcher = patch.dict(
            "os.environ", {jobs_runtime_module.NTFY_TOPIC_ENV: "test-topic"}
        )
        env_patcher.start()
        self.addCleanup(env_patcher.stop)

        send_patcher = patch.object(jobs_runtime_module, "_send_ntfy")
        self.send_mock = send_patcher.start()
        self.addCleanup(send_patcher.stop)

        self._reset_throttle()

    def _reset_throttle(self) -> None:
        jobs_runtime_module._next_notify_check_monotonic = 0.0

    def _seed_failures(
        self,
        count: int,
        error: str = "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        provider: str = "youtube",
        start: int = 0,
    ) -> list[str]:
        job_ids = []
        for index in range(start, start + count):
            job_id = f"job{index:04d}"
            create_job(
                self.db_path,
                job_id,
                source_id=f"vid{index:08d}",
                source_provider=provider,
            )
            set_job_status(self.db_path, job_id, "failed", error)
            job_ids.append(job_id)
        return job_ids

    def _set_updated_at(self, job_id: str, updated_at: str) -> None:
        with db_module._connect(self.db_path) as conn:
            conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (updated_at, job_id))
            conn.commit()

    def _set_last_sent(self, value: str) -> None:
        self.assertTrue(
            claim_notify_state(self.db_path, NOTIFY_LAST_SENT_KEY, None, value)
        )

    def _sent_message(self) -> str:
        self.assertEqual(self.send_mock.call_count, 1)
        return self.send_mock.call_args[0][1]

    def test_no_topic_env_short_circuits_before_db(self) -> None:
        missing_db = Path("/nonexistent") / "jobs.db"
        with patch.dict("os.environ", {}, clear=True):
            maybe_notify_youtube_failures(missing_db)
        self.send_mock.assert_not_called()

    def test_below_threshold_stays_silent(self) -> None:
        self._seed_failures(4)
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()
        self.assertIsNone(get_notify_state(self.db_path, NOTIFY_LAST_SENT_KEY))

    def test_threshold_pings_with_count_and_breakdown(self) -> None:
        self._seed_failures(3)
        self._seed_failures(
            2, error="ERROR: Sign in to confirm you're not a bot", start=3
        )
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("5 YouTube download failures piled up", message)
        self.assertIn("in the last 24.0h", message)
        self.assertIn("403 x3", message)
        self.assertIn("bot-check x2", message)
        self.assertIsNotNone(get_notify_state(self.db_path, NOTIFY_LAST_SENT_KEY))

    def test_non_youtube_failures_do_not_count(self) -> None:
        self._seed_failures(5, provider="soundcloud")
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_non_block_errors_do_not_count(self) -> None:
        self._seed_failures(5, error="ERROR: Sign in to confirm your age")
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_retried_to_success_leaves_the_count(self) -> None:
        job_ids = self._seed_failures(5)
        set_job_status(self.db_path, job_ids[0], "complete", None)
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_failures_older_than_first_run_window_do_not_count(self) -> None:
        job_ids = self._seed_failures(5)
        self._set_updated_at(job_ids[0], _utc_iso(timedelta(hours=-25)))
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_cooldown_suppresses_ping(self) -> None:
        self._seed_failures(5)
        self._set_last_sent(_utc_iso(timedelta(hours=-1)))
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_expired_cooldown_reports_pile_since_last_ping(self) -> None:
        self._seed_failures(7)
        self._set_last_sent(_utc_iso(timedelta(hours=-7)))
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("7 YouTube download failures piled up", message)
        self.assertIn("in the last 7.0h", message)

    def test_failures_before_last_ping_do_not_count(self) -> None:
        job_ids = self._seed_failures(7)
        self._set_last_sent(_utc_iso(timedelta(hours=-7)))
        for job_id in job_ids[:3]:
            self._set_updated_at(job_id, _utc_iso(timedelta(hours=-8)))
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_check_throttle_skips_repeat_calls(self) -> None:
        maybe_notify_youtube_failures(self.db_path)
        self._seed_failures(5)
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()
        self._reset_throttle()
        maybe_notify_youtube_failures(self.db_path)
        self.assertEqual(self.send_mock.call_count, 1)

    def test_window_is_capped_even_after_a_long_quiet_period(self) -> None:
        job_ids = self._seed_failures(5)
        self._set_last_sent(_utc_iso(timedelta(hours=-200)))
        self._set_updated_at(job_ids[0], _utc_iso(timedelta(hours=-30)))
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

        self._reset_throttle()
        self._set_updated_at(job_ids[0], _utc_iso(timedelta(hours=-1)))
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("in the last 24.0h", self._sent_message())

    def test_losing_the_claim_skips_the_send(self) -> None:
        self._seed_failures(5)
        with patch.object(jobs_runtime_module, "claim_notify_state", return_value=False):
            maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_notify_state_claim_is_single_winner(self) -> None:
        init_db(self.db_path)
        self.assertTrue(claim_notify_state(self.db_path, "k", None, "v1"))
        self.assertFalse(claim_notify_state(self.db_path, "k", None, "v2"))
        self.assertFalse(claim_notify_state(self.db_path, "k", "stale", "v3"))
        self.assertTrue(claim_notify_state(self.db_path, "k", "v1", "v2"))
        self.assertEqual(get_notify_state(self.db_path, "k"), "v2")


if __name__ == "__main__":
    unittest.main()
