from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from api.routes.config import get_app_config


class AppConfigTests(unittest.TestCase):
    def test_app_config_defaults_max_favorites_to_150(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            response = get_app_config()

        payload = json.loads(response.body)
        self.assertEqual(payload["max_favorites"], 150)

    def test_app_config_includes_configured_max_favorites(self) -> None:
        with patch.dict(os.environ, {"MAX_FAVORITES": "25"}, clear=True):
            response = get_app_config()

        payload = json.loads(response.body)
        self.assertEqual(payload["max_favorites"], 25)

    def test_app_config_falls_back_for_invalid_max_favorites(self) -> None:
        for value in ("", "nope", "0", "-1"):
            with self.subTest(value=value):
                with patch.dict(os.environ, {"MAX_FAVORITES": value}, clear=True):
                    response = get_app_config()

                payload = json.loads(response.body)
                self.assertEqual(payload["max_favorites"], 150)

    def test_app_config_includes_host_credit_env(self) -> None:
        with patch.dict(
            os.environ,
            {
                "HOSTED_BY_NAME": "  Example Host  ",
                "HOSTED_BY_URL": "  https://example.com  ",
            },
            clear=True,
        ):
            response = get_app_config()

        payload = json.loads(response.body)
        self.assertEqual(payload["hosted_by_name"], "Example Host")
        self.assertEqual(payload["hosted_by_url"], "https://example.com")

    def test_blank_host_credit_env_is_omitted(self) -> None:
        with patch.dict(
            os.environ,
            {
                "HOSTED_BY_NAME": " ",
                "HOSTED_BY_URL": "",
            },
            clear=True,
        ):
            response = get_app_config()

        payload = json.loads(response.body)
        self.assertIsNone(payload["hosted_by_name"])
        self.assertIsNone(payload["hosted_by_url"])


if __name__ == "__main__":
    unittest.main()
