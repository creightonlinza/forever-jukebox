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
    NOTIFY_PERIOD_START_KEY,
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

    def _seed_jobs(
        self,
        count: int,
        status: str = "failed",
        error: str | None = "ERROR: unable to download video data: HTTP Error 403: Forbidden",
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
            if status != "queued":
                set_job_status(self.db_path, job_id, status, error if status == "failed" else None)
            job_ids.append(job_id)
        return job_ids

    def _backdate(self, job_id: str, at: str) -> None:
        with db_module._connect(self.db_path) as conn:
            conn.execute(
                "UPDATE jobs SET created_at = ?, updated_at = ? WHERE id = ?", (at, at, job_id)
            )
            conn.commit()

    def _set_state(self, key: str, value: str) -> None:
        self.assertTrue(claim_notify_state(self.db_path, key, None, value))

    def _sent_message(self) -> str:
        self.assertEqual(self.send_mock.call_count, 1)
        return self.send_mock.call_args[0][1]

    @staticmethod
    def _clock(iso: str):
        frozen = datetime.fromisoformat(iso)

        class _FixedClock(datetime):
            @classmethod
            def now(cls, tz=None):
                return frozen

        return patch.object(jobs_runtime_module, "datetime", _FixedClock)

    def _period_close_time(self) -> str:
        start = datetime.fromisoformat(get_notify_state(self.db_path, NOTIFY_PERIOD_START_KEY))
        return (start + timedelta(seconds=jobs_runtime_module.NOTIFY_DIGEST_INTERVAL_S)).isoformat()

    def _close_period_now(self) -> None:
        self._reset_throttle()
        with self._clock(self._period_close_time()):
            maybe_notify_youtube_failures(self.db_path)

    def test_no_topic_env_short_circuits_before_db(self) -> None:
        missing_db = Path("/nonexistent") / "jobs.db"
        with patch.dict("os.environ", {}, clear=True):
            maybe_notify_youtube_failures(missing_db)
        self.send_mock.assert_not_called()

    def test_closing_a_period_records_its_end_even_when_silent(self) -> None:
        self._seed_jobs(3, status="complete")
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()
        self.assertIsNotNone(get_notify_state(self.db_path, NOTIFY_PERIOD_START_KEY))

    def test_below_threshold_stays_silent(self) -> None:
        self._seed_jobs(2)
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_threshold_sends_a_digest(self) -> None:
        self._seed_jobs(3)
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("3 of 3 failed", message)
        self.assertIn("(403 x3)", message)
        self.assertIn("No successful download on record.", message)

    def test_breakdown_lists_each_block_label(self) -> None:
        self._seed_jobs(3)
        self._seed_jobs(2, error="ERROR: Sign in to confirm you're not a bot", start=3)
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("5 of 5 failed", message)
        self.assertIn("403 x3", message)
        self.assertIn("bot-check x2", message)

    def test_non_youtube_failures_do_not_count(self) -> None:
        self._seed_jobs(5, provider="soundcloud")
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_non_block_errors_do_not_count(self) -> None:
        self._seed_jobs(5, error="ERROR: Sign in to confirm your age")
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_retried_to_success_drops_out(self) -> None:
        job_ids = self._seed_jobs(3)
        set_job_status(self.db_path, job_ids[0], "complete", None)
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_attempts_count_completes_and_block_failures_in_the_failure_span(self) -> None:
        self._seed_jobs(2)
        self._seed_jobs(1, status="complete", start=2)
        self._seed_jobs(1, error="ERROR: Sign in to confirm your age", start=3)
        self._seed_jobs(1, start=4)
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("3 of 4 failed", message)
        self.assertIn("No successful download since", message)

    def test_non_block_failures_are_not_counted_as_attempts(self) -> None:
        self._seed_jobs(3)
        self._seed_jobs(1, error="ERROR: Sign in to confirm your age", start=3)
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("3 of 3 failed", message)
        self.assertIn("No successful download on record.", message)

    def test_legacy_watermark_key_is_ignored(self) -> None:
        job_ids = self._seed_jobs(4)
        self._set_state("youtube_last_ntfy_at", _utc_iso(timedelta(hours=-30)))
        self._backdate(job_ids[0], _utc_iso(timedelta(hours=-20)))
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed", self._sent_message())

    def test_attempts_exclude_jobs_still_queued(self) -> None:
        self._seed_jobs(3)
        self._seed_jobs(2, status="queued", start=3)
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed", self._sent_message())

    def test_attempts_exclude_successes_outside_the_failure_span(self) -> None:
        self._seed_jobs(4, status="complete")
        self._seed_jobs(3, start=4)
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed", self._sent_message())

    def test_recovery_line_counts_successes_after_the_newest_failure(self) -> None:
        self._seed_jobs(3)
        self._seed_jobs(3, status="complete", start=3)
        maybe_notify_youtube_failures(self.db_path)
        message = self._sent_message()
        self.assertIn("3 of 3 failed", message)
        self.assertIn("Recovered: 3 successes since, last ", message)

    def test_recovery_line_uses_singular_for_one_success(self) -> None:
        self._seed_jobs(3)
        self._seed_jobs(1, status="complete", start=3)
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("Recovered: 1 success since, last ", self._sent_message())

    def test_open_period_is_left_alone(self) -> None:
        self._seed_jobs(5)
        self._set_state(NOTIFY_PERIOD_START_KEY, _utc_iso(timedelta(hours=-1)))
        maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_failures_before_the_period_do_not_count(self) -> None:
        job_ids = self._seed_jobs(7)
        self._set_state(NOTIFY_PERIOD_START_KEY, _utc_iso(timedelta(hours=-7)))
        for job_id in job_ids[:3]:
            self._backdate(job_id, _utc_iso(timedelta(hours=-8)))
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("4 of 4 failed", self._sent_message())

    def test_period_covers_everything_since_the_previous_close(self) -> None:
        job_ids = self._seed_jobs(3)
        self._set_state(NOTIFY_PERIOD_START_KEY, _utc_iso(timedelta(hours=-7)))
        self._backdate(job_ids[0], _utc_iso(timedelta(hours=-6, minutes=-30)))
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed", self._sent_message())

    def test_first_period_only_looks_back_one_interval(self) -> None:
        job_ids = self._seed_jobs(5)
        self._backdate(job_ids[0], _utc_iso(timedelta(hours=-7)))
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("4 of 4 failed", self._sent_message())

    def test_naive_stored_period_start_is_treated_as_utc(self) -> None:
        self._seed_jobs(3)
        naive = (datetime.now(timezone.utc) - timedelta(hours=7)).replace(tzinfo=None)
        self._set_state(NOTIFY_PERIOD_START_KEY, naive.isoformat())
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed", self._sent_message())

    def test_sub_threshold_failures_do_not_carry_into_the_next_period(self) -> None:
        self._set_state(NOTIFY_PERIOD_START_KEY, _utc_iso(timedelta(hours=-7)))
        self._seed_jobs(2)
        maybe_notify_youtube_failures(self.db_path)
        self._seed_jobs(2, start=2)
        self._close_period_now()
        self.send_mock.assert_not_called()

    def test_reported_failures_are_not_reported_again(self) -> None:
        self._set_state(NOTIFY_PERIOD_START_KEY, _utc_iso(timedelta(hours=-7)))
        self._seed_jobs(3)
        maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed", self._sent_message())
        self._close_period_now()
        self.assertEqual(self.send_mock.call_count, 1)

    def test_failures_landing_after_the_period_closes_go_to_the_next_one(self) -> None:
        self._set_state(NOTIFY_PERIOD_START_KEY, _utc_iso(timedelta(hours=-7)))
        self._seed_jobs(3)
        # The check samples `now` before it queries; a failure committed in
        # between is newer than that sample.
        with self._clock(_utc_iso(timedelta(seconds=-1))):
            maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()
        self._seed_jobs(3, start=3)
        self._close_period_now()
        self.assertIn("6 of 6 failed", self._sent_message())

    def test_check_throttle_skips_repeat_calls(self) -> None:
        maybe_notify_youtube_failures(self.db_path)
        self._seed_jobs(3)
        with self._clock(self._period_close_time()):
            maybe_notify_youtube_failures(self.db_path)
            self.send_mock.assert_not_called()
            self._reset_throttle()
            maybe_notify_youtube_failures(self.db_path)
        self.assertEqual(self.send_mock.call_count, 1)

    def test_losing_the_claim_skips_the_send(self) -> None:
        self._seed_jobs(3)
        with patch.object(jobs_runtime_module, "claim_notify_state", return_value=False):
            maybe_notify_youtube_failures(self.db_path)
        self.send_mock.assert_not_called()

    def test_notify_state_claim_is_single_winner(self) -> None:
        self.assertTrue(claim_notify_state(self.db_path, "k", None, "v1"))
        self.assertFalse(claim_notify_state(self.db_path, "k", None, "v2"))
        self.assertFalse(claim_notify_state(self.db_path, "k", "stale", "v3"))
        self.assertTrue(claim_notify_state(self.db_path, "k", "v1", "v2"))
        self.assertEqual(get_notify_state(self.db_path, "k"), "v2")

    def _seed_fixed_span(self, *stamps: str) -> None:
        job_ids = self._seed_jobs(len(stamps))
        for job_id, stamp in zip(job_ids, stamps):
            self._backdate(job_id, stamp)
        self._set_state(NOTIFY_PERIOD_START_KEY, "2026-09-12T00:00:00+00:00")

    def test_span_is_rendered_in_utc(self) -> None:
        self._seed_fixed_span(
            "2026-09-13T07:14:02+00:00", "2026-09-13T07:20:46+00:00", "2026-09-13T08:21:53+00:00"
        )
        with self._clock("2026-09-13T09:00:00+00:00"):
            maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed Sep 13 07:14\u201308:21 UTC (403 x3)", self._sent_message())

    def test_span_crossing_midnight_names_both_days(self) -> None:
        self._seed_fixed_span(
            "2026-09-12T23:50:00+00:00", "2026-09-13T00:10:00+00:00", "2026-09-13T00:30:00+00:00"
        )
        with self._clock("2026-09-13T01:00:00+00:00"):
            maybe_notify_youtube_failures(self.db_path)
        self.assertIn("failed Sep 12 23:50\u2013Sep 13 00:30 UTC", self._sent_message())

    def test_span_within_one_minute_is_one_moment(self) -> None:
        self._seed_fixed_span(
            "2026-09-13T13:25:45+00:00", "2026-09-13T13:25:50+00:00", "2026-09-13T13:25:55+00:00"
        )
        with self._clock("2026-09-13T14:00:00+00:00"):
            maybe_notify_youtube_failures(self.db_path)
        self.assertIn("3 of 3 failed Sep 13 13:25 UTC (403 x3)", self._sent_message())


if __name__ == "__main__":
    unittest.main()
