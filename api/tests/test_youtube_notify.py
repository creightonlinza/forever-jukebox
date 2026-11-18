from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from api import db as db_module
from api.db import create_job, init_db, set_job_status
from api.routes import jobs_runtime as jobs_runtime_module
from api.routes.jobs_runtime import (
    ERROR_YOUTUBE_COOLDOWN,
    download_source_audio,
    failure_code_for,
    record_youtube_failure,
    record_youtube_success,
    refuse_youtube_download,
    resolve_source_info,
    youtube_block_signal,
    youtube_block_status,
)

BOT_CHECK = "ERROR: [youtube] abc: Sign in to confirm you're not a bot"
HTTP_403 = "ERROR: unable to download video data: HTTP Error 403: Forbidden"
START = datetime(2026, 11, 18, 2, 30, tzinfo=timezone.utc)


class YoutubeBlockSignalTests(unittest.TestCase):
    def test_labels_for_block_errors(self) -> None:
        cases = {
            HTTP_403: "403",
            BOT_CHECK: "bot-check",
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
            "ERROR: [youtube] abc: Please sign in. This helps protect our community.",
            "ERROR: This video is age-restricted",
            "ERROR: Video unavailable",
            "ERROR: Something went wrong.",
        ]
        for raw in cases:
            self.assertIsNone(youtube_block_signal(raw), raw)

    def test_error_codes(self) -> None:
        cases = {
            HTTP_403: "youtube_unreachable",
            BOT_CHECK: "youtube_unreachable",
            ERROR_YOUTUBE_COOLDOWN: "youtube_unreachable",
            "ERROR: [youtube] abc: Please sign in. Use --cookies": "youtube_age_restricted",
            "ERROR: [download] Got error": "download_unavailable",
            "ERROR: Connection timed out": "generic_error",
        }
        for raw, expected in cases.items():
            self.assertEqual(failure_code_for(raw), expected, raw)


class YoutubeCooldownTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.db_path = Path(temp_dir.name) / "jobs.db"
        init_db(self.db_path)
        self.now = START
        self.failed = 0
        test = self

        class _Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return test.now

        self.send_mock = MagicMock(return_value=True)
        for target, value in (
            ("DB_PATH", self.db_path),
            ("datetime", _Clock),
            ("_send_ntfy", self.send_mock),
        ):
            patcher = patch.object(jobs_runtime_module, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        env_patcher = patch.dict("os.environ", {jobs_runtime_module.NTFY_TOPIC_ENV: "test-topic"})
        env_patcher.start()
        self.addCleanup(env_patcher.stop)

    def _advance(self, minutes: float) -> None:
        self.now += timedelta(minutes=minutes)

    def _fail(self, count: int, error: str = BOT_CHECK, job: str | None = None) -> None:
        for _ in range(count):
            self.failed += 1
            record_youtube_failure(error, job or f"job{self.failed}")

    def _messages(self) -> list[str]:
        return [call.args[1] for call in self.send_mock.call_args_list]

    def test_two_failures_do_not_start_a_cooldown(self) -> None:
        self._fail(2)
        self.assertFalse(refuse_youtube_download())
        self.assertEqual(youtube_block_status()["status"], "failing")

    def test_repeat_failures_of_one_video_do_not_start_a_cooldown(self) -> None:
        self._fail(5, job="same")
        self.assertFalse(refuse_youtube_download())
        status = youtube_block_status()
        self.assertEqual(status["labels"], {"bot-check": 5})
        self.assertNotIn("jobs", status)

    def test_non_block_failure_is_not_counted(self) -> None:
        self._fail(3, "ERROR: Video unavailable")
        self.assertEqual(youtube_block_status()["status"], "ok")

    def test_third_failure_starts_a_cooldown_that_ends_after_its_length(self) -> None:
        self._fail(3)
        self.assertTrue(refuse_youtube_download())
        self.assertEqual(youtube_block_status()["status"], "blocked")
        self._advance(9)
        self.assertTrue(refuse_youtube_download())
        self._advance(2)
        self.assertFalse(refuse_youtube_download())
        self.assertEqual(self._messages(), [])
        status = youtube_block_status()
        self.assertEqual((status["status"], status["refused"]), ("failing", 2))

    def test_failure_during_cooldown_does_not_alert(self) -> None:
        self._fail(4)
        self.assertEqual(self._messages(), [])

    def test_first_failed_test_request_alerts_once(self) -> None:
        self._fail(3)
        refuse_youtube_download()
        self._advance(11)
        self._fail(1, HTTP_403)
        self.assertTrue(refuse_youtube_download())
        self._advance(11)
        self.assertEqual(youtube_block_status()["status"], "blocked")
        self._fail(1)
        self.assertEqual(
            self._messages(),
            [
                "[Forever Jukebox] YouTube blocked since Nov 18 02:30 UTC: 4 failed "
                "(bot-check x3, 403 x1), 1 refused. No successful download on record."
            ],
        )

    def test_success_after_alert_reports_recovery_and_clears(self) -> None:
        create_job(self.db_path, "done", source_id="vid00000001", source_provider="youtube")
        set_job_status(self.db_path, "done", "complete", None)
        with db_module._connect(self.db_path) as conn:
            conn.execute("UPDATE jobs SET updated_at = '2026-11-18T02:18:49+00:00' WHERE id = 'done'")
            conn.commit()
        self._fail(3)
        self._advance(11)
        self._fail(1)
        self._advance(11)
        self.send_mock.reset_mock()
        record_youtube_success()
        self.assertEqual(
            self._messages(),
            [
                "[Forever Jukebox] YouTube recovered: download succeeded Nov 18 02:52 UTC, "
                "first since Nov 18 02:18 UTC. 4 failed (bot-check x4), 0 refused."
            ],
        )
        self.assertEqual(youtube_block_status()["status"], "ok")
        self.assertFalse(refuse_youtube_download())

    def test_success_without_alert_clears_silently(self) -> None:
        self._fail(3)
        record_youtube_success()
        self.assertEqual(self._messages(), [])
        self.assertFalse(refuse_youtube_download())

    def test_failed_blocked_send_is_retried_and_failed_recovered_send_is_not(self) -> None:
        self.send_mock.return_value = False
        self._fail(3)
        self._advance(11)
        self._fail(1)
        self._advance(11)
        self.send_mock.return_value = True
        self._fail(1)
        self.assertEqual(len(self._messages()), 2)
        self.send_mock.return_value = False
        record_youtube_success()
        self.assertEqual(youtube_block_status()["status"], "ok")
        record_youtube_success()
        self.assertEqual(len(self._messages()), 3)

    def test_no_topic_key_still_runs_the_cooldown(self) -> None:
        with patch.dict("os.environ", {jobs_runtime_module.NTFY_TOPIC_ENV: ""}):
            self._fail(3)
            self._advance(11)
            self._fail(1)
            self.assertTrue(refuse_youtube_download())
        self.assertEqual(self._messages(), [])

    def test_download_in_cooldown_fails_without_a_youtube_call(self) -> None:
        self._fail(3)
        with (
            patch.object(jobs_runtime_module, "cleanup_failure") as cleanup,
            patch.object(jobs_runtime_module, "_download_with_403_retry") as download,
        ):
            download_source_audio("job1", "https://www.youtube.com/watch?v=abcdefghijk", "youtube", "owner")
            with self.assertRaisesRegex(ValueError, "cooldown"):
                resolve_source_info("https://www.youtube.com/watch?v=abcdefghijk")
        download.assert_not_called()
        cleanup.assert_called_once_with("job1", ERROR_YOUTUBE_COOLDOWN, "youtube", "owner")

    def test_other_providers_are_not_refused_or_counted(self) -> None:
        self._fail(3)
        with (
            patch.object(jobs_runtime_module, "cleanup_failure"),
            patch.object(jobs_runtime_module, "get_store"),
            patch.object(
                jobs_runtime_module, "_download_with_403_retry", side_effect=RuntimeError(HTTP_403)
            ) as download,
        ):
            download_source_audio("job1", "https://soundcloud.com/a/b", "soundcloud", "owner")
        download.assert_called_once()
        self.assertEqual(youtube_block_status()["labels"], {"bot-check": 3})


if __name__ == "__main__":
    unittest.main()
