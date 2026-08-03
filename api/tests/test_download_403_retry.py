from __future__ import annotations

import unittest
from unittest.mock import patch

from api.routes import jobs_runtime as jobs_runtime_module
from api.routes.jobs_runtime import _download_with_403_retry


def make_fake_ydl_cls(outcomes: list[object]) -> tuple[type, list[dict]]:
    """Build a YoutubeDL stand-in that pops one outcome per extract_info call.

    An Exception outcome is raised; anything else is returned. Records each
    call's opts and URL for assertions.
    """
    calls: list[dict] = []

    class FakeYoutubeDL:
        def __init__(self, opts: dict) -> None:
            self.opts = opts

        def __enter__(self) -> "FakeYoutubeDL":
            return self

        def __exit__(self, *exc_info: object) -> None:
            return None

        def extract_info(self, url: str, download: bool = False) -> object:
            calls.append({"opts": self.opts, "url": url, "download": download})
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    return FakeYoutubeDL, calls


class Download403RetryTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(jobs_runtime_module, "HTTP_403_RETRY_DELAY_S", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_success_on_first_attempt_does_not_retry(self) -> None:
        info = {"id": "abc"}
        ydl_cls, calls = make_fake_ydl_cls([info])

        result = _download_with_403_retry(
            ydl_cls, {"format": "bestaudio"}, "https://example.test/v", "job1", "youtube"
        )

        self.assertIs(result, info)
        self.assertEqual(len(calls), 1)

    def test_http_403_retries_once_and_succeeds(self) -> None:
        info = {"id": "abc"}
        ydl_cls, calls = make_fake_ydl_cls(
            [RuntimeError("ERROR: unable to download video data: HTTP Error 403: Forbidden"), info]
        )
        on_retry_calls: list[int] = []

        def on_retry() -> None:
            # Records how many download attempts had run when the hook fired,
            # proving it runs between attempt 1 and attempt 2.
            on_retry_calls.append(len(calls))

        result = _download_with_403_retry(
            ydl_cls,
            {"format": "bestaudio"},
            "https://example.test/v",
            "job1",
            "youtube",
            on_retry=on_retry,
        )

        self.assertIs(result, info)
        self.assertEqual(len(calls), 2)
        self.assertEqual(on_retry_calls, [1])
        self.assertTrue(all(call["download"] for call in calls))
        self.assertTrue(all(call["url"] == "https://example.test/v" for call in calls))

    def test_http_403_on_both_attempts_raises(self) -> None:
        first = RuntimeError("HTTP Error 403: Forbidden")
        second = RuntimeError("HTTP Error 403: Forbidden")
        ydl_cls, calls = make_fake_ydl_cls([first, second])

        with self.assertRaises(RuntimeError) as ctx:
            _download_with_403_retry(
                ydl_cls, {}, "https://example.test/v", "job1", "youtube"
            )

        self.assertIs(ctx.exception, second)
        self.assertEqual(len(calls), 2)

    def test_non_403_error_does_not_retry(self) -> None:
        error = RuntimeError("ERROR: Video unavailable")
        ydl_cls, calls = make_fake_ydl_cls([error])
        on_retry_calls: list[int] = []

        with self.assertRaises(RuntimeError) as ctx:
            _download_with_403_retry(
                ydl_cls,
                {},
                "https://example.test/v",
                "job1",
                "youtube",
                on_retry=lambda: on_retry_calls.append(len(calls)),
            )

        self.assertIs(ctx.exception, error)
        self.assertEqual(len(calls), 1)
        self.assertEqual(on_retry_calls, [])


if __name__ == "__main__":
    unittest.main()
