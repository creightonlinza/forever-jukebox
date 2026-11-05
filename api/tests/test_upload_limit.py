from __future__ import annotations

import asyncio
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

from api.routes.jobs import upload_audio


class UploadLimitTests(unittest.TestCase):
    def test_rejects_an_upload_over_max_upload_mb_and_removes_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            storage = Path(tmp)
            upload = UploadFile(file=io.BytesIO(b"\0" * (1024 * 1024 + 1)), filename="song.mp3")
            env = {"ALLOW_USER_UPLOAD": "true", "MAX_UPLOAD_MB": "1"}
            with patch.dict(os.environ, env, clear=True), patch(
                "api.routes.jobs.STORAGE_ROOT", storage
            ):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(upload_audio(upload))

            self.assertEqual(raised.exception.status_code, 413)
            self.assertEqual(list((storage / "audio").iterdir()), [])
