from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class DeploymentConfigTests(unittest.TestCase):
    def test_entrypoint_trusts_reverse_proxy_headers(self) -> None:
        entrypoint = (REPO_ROOT / "docker" / "entrypoint.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("--proxy-headers", entrypoint)
        self.assertIn('--forwarded-allow-ips "*"', entrypoint)
