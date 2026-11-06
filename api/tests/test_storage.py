from __future__ import annotations

import asyncio
import gzip
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from api import storage
from fastapi import BackgroundTasks, UploadFile

from api.db import create_job, get_job, init_db
from api.routes import jobs, jobs_runtime, media
from api.storage import LocalStore, S3Store, get_store
from scripts import sync_storage_to_tigris as sync
from worker import worker as worker_module

TIGRIS_ENV = {
    "BUCKET_NAME": "bucket",
    "AWS_ENDPOINT_URL_S3": "https://storage.example",
    "AWS_ACCESS_KEY_ID": "test-key-id",
    "AWS_SECRET_ACCESS_KEY": "test-secret",
}


class FakeClientError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3:
    """In-memory stand-in for the boto3 S3 client calls S3Store makes."""

    def __init__(self) -> None:
        self.objects: dict[str, dict] = {}
        self.calls: list[str] = []
        self.presigned: list[tuple[dict, int]] = []

    def _put(self, key: str, body: bytes, extra: dict | None) -> None:
        extra = extra or {}
        self.objects[key] = {
            "body": body,
            "ContentType": extra.get("ContentType", "binary/octet-stream"),
            "Metadata": extra.get("Metadata", {}),
            "LastModified": datetime(2026, 1, 2, tzinfo=timezone.utc),
        }

    def _get(self, key: str, code: str) -> dict:
        if key not in self.objects:
            raise FakeClientError(code)
        return self.objects[key]

    def upload_file(self, filename, bucket, key, ExtraArgs=None, Config=None):
        self.calls.append("upload_file")
        self._put(key, Path(filename).read_bytes(), ExtraArgs)

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.calls.append("put_object")
        self._put(Key, Body, {"ContentType": ContentType})

    def head_object(self, Bucket, Key):
        self.calls.append("head_object")
        obj = self._get(Key, "404")
        return {
            "ContentLength": len(obj["body"]),
            "ContentType": obj["ContentType"],
            "Metadata": obj["Metadata"],
            "LastModified": obj["LastModified"],
        }

    def get_object(self, Bucket, Key):
        self.calls.append("get_object")
        return {"Body": io.BytesIO(self._get(Key, "NoSuchKey")["body"])}

    def download_file(self, bucket, key, filename):
        self.calls.append("download_file")
        Path(filename).write_bytes(self._get(key, "404")["body"])

    def delete_object(self, Bucket, Key):
        self.calls.append("delete_object")
        self.objects.pop(Key, None)

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.presigned.append((Params, ExpiresIn))
        return f"https://bucket.storage.example/{Params['Key']}?sig=1"

    def get_paginator(self, name):
        objects = self.objects

        class Paginator:
            def paginate(self, Bucket, Prefix):
                yield {
                    "Contents": [
                        {
                            "Key": key,
                            "Size": len(obj["body"]),
                            "ETag": f'"{hashlib.md5(obj["body"]).hexdigest()}"',
                        }
                        for key, obj in objects.items()
                        if key.startswith(Prefix)
                    ]
                }

        return Paginator()


def _env_without_backend() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k != storage.STORAGE_BACKEND_ENV}


class GetStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        storage._tigris_store.cache_clear()
        self.addCleanup(storage._tigris_store.cache_clear)

    def test_defaults_to_local_store(self) -> None:
        with patch.dict(os.environ, _env_without_backend(), clear=True):
            store = get_store(Path("/data"))
        self.assertIsInstance(store, LocalStore)
        self.assertEqual(store.root, Path("/data"))

    def test_tigris_credentials_alone_do_not_enable_tigris(self) -> None:
        with patch.dict(os.environ, {**_env_without_backend(), **TIGRIS_ENV}, clear=True):
            self.assertIsInstance(get_store(Path("/data")), LocalStore)

    def test_explicit_local_backend(self) -> None:
        with patch.dict(os.environ, {storage.STORAGE_BACKEND_ENV: "local"}):
            self.assertIsInstance(get_store(Path("/data")), LocalStore)

    def test_tigris_backend_uses_bucket_from_env(self) -> None:
        with patch.dict(os.environ, {**TIGRIS_ENV, storage.STORAGE_BACKEND_ENV: "tigris"}):
            store = get_store(Path("/data"))
        self.assertIsInstance(store, S3Store)
        self.assertEqual(store.bucket, "bucket")

    def test_tigris_backend_without_bucket_fails(self) -> None:
        env = {storage.STORAGE_BACKEND_ENV: "tigris", "BUCKET_NAME": "", "AWS_ENDPOINT_URL_S3": ""}
        with patch.dict(os.environ, env):
            with self.assertRaises(RuntimeError):
                get_store(Path("/data"))

    def test_tigris_backend_without_access_keys_fails(self) -> None:
        env = {**TIGRIS_ENV, storage.STORAGE_BACKEND_ENV: "tigris", "AWS_SECRET_ACCESS_KEY": ""}
        with patch.dict(os.environ, env):
            with self.assertRaisesRegex(RuntimeError, "AWS_SECRET_ACCESS_KEY"):
                get_store(Path("/data"))

    def test_unknown_backend_fails(self) -> None:
        with patch.dict(os.environ, {storage.STORAGE_BACKEND_ENV: "nfs"}):
            with self.assertRaises(RuntimeError):
                get_store(Path("/data"))


class LocalStoreTests(unittest.TestCase):
    def test_reads_sizes_and_deletes_files_under_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "audio").mkdir()
            (root / "analysis").mkdir()
            (root / "audio" / "job1.m4a").write_bytes(b"audio")
            (root / "analysis" / "job1.json.gz").write_bytes(gzip.compress(b'{"a": 1}'))
            store = LocalStore(root)

            self.assertTrue(store.has_audio("job1"))
            self.assertTrue(store.has_analysis("job1"))
            self.assertEqual(store.read_analysis("job1"), {"a": 1})
            self.assertIsNotNone(store.analysis_mtime("job1"))
            self.assertGreater(store.artifact_bytes(["job1"])["job1"], 5)

            store.delete_audio("job1")
            store.delete_analysis("job1")

            self.assertFalse(store.has_audio("job1"))
            self.assertIsNone(store.read_analysis("job1"))
            self.assertIsNone(store.analysis_mtime("job1"))
            self.assertIsNone(store.audio_response("job1"))


class DiscardJobFilesTests(unittest.TestCase):
    def test_local_store_errors_still_raise(self) -> None:
        store = LocalStore(Path("/data"))
        with patch.object(store, "delete_audio", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                storage.discard_job_files(store, "job1")


class S3StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.scratch = Path(temp_dir.name)
        self.client = FakeS3()
        self.store = S3Store("bucket", self.scratch, client=self.client)

    def _scratch_audio(self, name: str, body: bytes = b"audio") -> Path:
        path = self.store.audio_dir() / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return path

    def test_save_audio_uploads_without_extension_and_keeps_scratch_copy(self) -> None:
        path = self._scratch_audio("job1.mp3")

        self.store.save_audio("job1", path)

        obj = self.client.objects["audio/job1"]
        self.assertEqual(obj["body"], b"audio")
        self.assertEqual(obj["ContentType"], "audio/mpeg")
        self.assertEqual(obj["Metadata"], {"ext": ".mp3"})
        self.assertTrue(path.exists())
        self.assertTrue(self.store.has_audio("job1"))
        self.assertFalse(self.store.has_audio("other"))

    def test_unexpected_errors_are_not_treated_as_missing(self) -> None:
        def denied(**kwargs):
            raise FakeClientError("AccessDenied")

        self.client.head_object = denied
        with self.assertRaises(FakeClientError):
            self.store.has_audio("job1")

    def test_local_audio_reuses_scratch_copy_then_removes_it(self) -> None:
        path = self._scratch_audio("job1.webm")

        with self.store.local_audio("job1") as local:
            self.assertEqual(local, path)

        self.assertNotIn("download_file", self.client.calls)
        self.assertFalse(path.exists())

    def test_local_audio_downloads_with_original_extension(self) -> None:
        self.client._put("audio/job1", b"remote", {"Metadata": {"ext": ".m4a"}})

        with self.store.local_audio("job1") as local:
            self.assertEqual(local.name, "job1.m4a")
            self.assertEqual(local.read_bytes(), b"remote")

        self.assertEqual(list(self.store.audio_dir().iterdir()), [])

    def test_local_audio_is_none_when_missing_and_cleans_up_on_error(self) -> None:
        with self.store.local_audio("job1") as local:
            self.assertIsNone(local)

        self.client._put("audio/job2", b"remote", {"Metadata": {"ext": ".mp3"}})
        with self.assertRaises(ValueError):
            with self.store.local_audio("job2"):
                raise ValueError("engine failed")
        self.assertEqual(list(self.store.audio_dir().iterdir()), [])

    def test_analysis_round_trip(self) -> None:
        gz_path = self.store.analysis_output_path("job1").with_suffix(".json.gz")
        gz_path.parent.mkdir(parents=True, exist_ok=True)
        gz_path.write_bytes(gzip.compress(json.dumps({"track": {}}).encode()))

        self.store.save_analysis("job1", gz_path)

        self.assertFalse(gz_path.exists())
        self.assertEqual(self.client.objects["analysis/job1.json.gz"]["ContentType"], "application/gzip")
        self.assertTrue(self.store.has_analysis("job1"))
        self.assertEqual(self.store.read_analysis("job1"), {"track": {}})
        self.assertEqual(
            self.store.analysis_mtime("job1"), datetime(2026, 1, 2, tzinfo=timezone.utc)
        )
        self.assertIsNone(self.store.read_analysis("missing"))
        self.assertIsNone(self.store.analysis_mtime("missing"))

    def test_redirect_keeps_real_presigned_url_intact(self) -> None:
        env = {
            "AWS_ENDPOINT_URL_S3": "https://fly.storage.tigris.dev",
            "AWS_ACCESS_KEY_ID": "tid_example",
            "AWS_SECRET_ACCESS_KEY": "tsec_example",
            "AWS_REGION": "auto",
        }
        with patch.dict(os.environ, env):
            store = S3Store("bucket", self.scratch)
            url = store.client.generate_presigned_url(
                "get_object", Params={"Bucket": "bucket", "Key": "audio/job1"}, ExpiresIn=600
            )
            response = store.audio_response("job1")

        self.assertIn("%2F", url)
        location = response.headers["location"]
        self.assertNotIn("%25", location)
        self.assertEqual(location.split("X-Amz-Signature=")[0], url.split("X-Amz-Signature=")[0])

    def test_audio_response_redirects_to_short_lived_url_without_bucket_calls(self) -> None:
        response = self.store.audio_response("job1")

        self.assertEqual(response.status_code, 307)
        self.assertEqual(
            response.headers["location"], "https://bucket.storage.example/audio/job1?sig=1"
        )
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.client.presigned, [({"Bucket": "bucket", "Key": "audio/job1"}, 600)])
        self.assertEqual(self.client.calls, [])

    def test_deletes_remove_objects_and_scratch_files(self) -> None:
        self.client._put("audio/job1", b"audio", None)
        self.client._put("analysis/job1.json.gz", b"gz", None)
        self._scratch_audio("job1.webm.part")
        analysis_scratch = self.scratch / "analysis" / "job1.json"
        analysis_scratch.parent.mkdir(parents=True)
        analysis_scratch.write_text("{}")
        self.assertEqual(self.store.artifact_bytes(["job1", "job2"]), {"job1": 7, "job2": 0})
        self.assertNotIn("head_object", self.client.calls)

        self.store.delete_audio("job1")
        self.store.delete_analysis("job1")

        self.assertEqual(self.client.objects, {})
        self.assertEqual(list(self.store.audio_dir().iterdir()), [])
        self.assertFalse(analysis_scratch.exists())
        self.assertEqual(self.store.artifact_bytes(["job1"]), {"job1": 0})
        self.assertEqual(self.store.artifact_bytes([]), {})


class TigrisRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        self.db_path = root / "jobs.db"
        init_db(self.db_path)
        self.client = FakeS3()
        self.store = S3Store("bucket", root / "scratch", client=self.client)
        for target in (
            patch.dict(os.environ, {storage.STORAGE_BACKEND_ENV: "tigris"}),
            patch.object(storage, "_tigris_store", return_value=self.store),
            patch.object(jobs, "DB_PATH", self.db_path),
            patch.object(media, "DB_PATH", self.db_path),
        ):
            target.start()
            self.addCleanup(target.stop)

    def test_audio_route_redirects(self) -> None:
        create_job(self.db_path, "job1", status="complete", source_provider="upload")

        response = media.get_audio("job1")

        self.assertEqual(response.status_code, 307)
        self.assertIn("audio/job1", response.headers["location"])

    def test_analysis_route_reads_bucket_and_patches_metadata(self) -> None:
        create_job(
            self.db_path,
            "job1",
            status="complete",
            source_provider="upload",
            track_title="Song",
            track_artist="Artist",
        )
        self.client._put("analysis/job1.json.gz", gzip.compress(b'{"track": {}}'), None)
        self.client._put("audio/job1", b"audio", None)

        response = jobs._job_response(jobs.get_job(self.db_path, "job1"))
        payload = json.loads(response.body)

        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["result"]["track"], {"title": "Song", "artist": "Artist"})

    def test_repair_for_missing_audio_does_not_recheck_objects(self) -> None:
        create_job(
            self.db_path,
            "job1",
            status="complete",
            source_url="https://soundcloud.com/artist/song",
            source_provider="soundcloud",
        )
        self.client._put("analysis/job1.json.gz", gzip.compress(b'{"track": {}}'), None)
        tasks = BackgroundTasks()

        with patch.object(jobs, "claim_job_for_download", return_value="owner"):
            jobs._response_with_auto_repair(get_job(self.db_path, "job1"), tasks)

        self.assertEqual(self.client.calls, ["get_object", "head_object"])
        self.assertEqual(len(tasks.tasks), 1)

    def test_missing_bucket_objects_trigger_auto_repair(self) -> None:
        job = SimpleNamespace(
            id="job1",
            status="complete",
            source_id=None,
            source_url=None,
            source_provider=None,
        )
        self.assertTrue(jobs._should_attempt_auto_repair(job))
        self.client._put("analysis/job1.json.gz", gzip.compress(b"{}"), None)
        self.assertFalse(jobs._should_attempt_auto_repair(job))

    def test_completed_track_load_reads_analysis_once_without_extra_head(self) -> None:
        create_job(
            self.db_path,
            "job1",
            status="complete",
            source_url="https://soundcloud.com/artist/song",
            source_provider="soundcloud",
        )
        self.client._put("analysis/job1.json.gz", gzip.compress(b'{"track": {}}'), None)
        self.client._put("audio/job1", b"audio", None)

        response = jobs._response_with_auto_repair(get_job(self.db_path, "job1"), BackgroundTasks())

        self.assertEqual(json.loads(response.body)["status"], "complete")
        self.assertEqual(self.client.calls, ["get_object", "head_object"])


def _failing(*args, **kwargs):
    raise FakeClientError("InternalError")


class FakeYoutubeDL:
    def __init__(self, opts: dict) -> None:
        self.opts = opts

    def __enter__(self) -> "FakeYoutubeDL":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def extract_info(self, url: str, download: bool = False) -> dict:
        path = Path(self.opts["outtmpl"].replace("%(ext)s", "webm"))
        path.write_bytes(b"downloaded")
        return {"requested_downloads": [{"filepath": str(path)}], "title": "Song"}


class TigrisIngestTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.root = Path(temp_dir.name)
        self.db_path = self.root / "jobs.db"
        init_db(self.db_path)
        self.client = FakeS3()
        self.store = S3Store("bucket", self.root / "scratch", client=self.client)
        for target in (
            patch.dict(
                os.environ,
                {
                    storage.STORAGE_BACKEND_ENV: "tigris",
                    "ALLOW_USER_UPLOAD": "true",
                    "MAX_TRACK_LENGTH": "",
                },
            ),
            patch.object(storage, "_tigris_store", return_value=self.store),
            patch.object(jobs, "DB_PATH", self.db_path),
            patch.object(jobs_runtime, "DB_PATH", self.db_path),
            patch.object(jobs_runtime, "STORAGE_ROOT", self.root / "storage"),
            patch.object(worker_module, "DB_PATH", self.db_path),
            patch.object(worker_module, "STORAGE_ROOT", self.root / "storage"),
        ):
            target.start()
            self.addCleanup(target.stop)

    def test_download_uploads_audio_before_queueing(self) -> None:
        create_job(self.db_path, "job1", status="downloading", source_provider="youtube", source_id="abc")

        with patch("yt_dlp.YoutubeDL", FakeYoutubeDL):
            jobs_runtime.download_source_audio("job1", "https://youtu.be/abc", "youtube")

        job = get_job(self.db_path, "job1")
        self.assertEqual(job.status, "queued")
        self.assertEqual(self.client.objects["audio/job1"]["body"], b"downloaded")
        self.assertEqual(self.client.objects["audio/job1"]["Metadata"], {"ext": ".webm"})
        self.assertTrue((self.store.audio_dir() / "job1.webm").exists())

    def test_download_fails_job_when_upload_fails(self) -> None:
        create_job(self.db_path, "job1", status="downloading", source_provider="youtube", source_id="abc")
        self.client.upload_file = _failing

        with patch("yt_dlp.YoutubeDL", FakeYoutubeDL):
            jobs_runtime.download_source_audio("job1", "https://youtu.be/abc", "youtube")

        job = get_job(self.db_path, "job1")
        self.assertEqual(job.status, "failed")
        self.assertIn("Audio upload failed", job.error)
        self.assertEqual(list(self.store.audio_dir().iterdir()), [])

    def test_upload_route_stores_audio_before_creating_job(self) -> None:
        upload = UploadFile(file=io.BytesIO(b"mp3 bytes"), filename="song.mp3")

        response = asyncio.run(jobs.upload_audio(upload))

        job_id = json.loads(response.body)["id"]
        self.assertEqual(get_job(self.db_path, job_id).status, "queued")
        obj = self.client.objects[f"audio/{job_id}"]
        self.assertEqual((obj["body"], obj["ContentType"]), (b"mp3 bytes", "audio/mpeg"))

    def test_failure_cleanup_survives_bucket_errors(self) -> None:
        create_job(self.db_path, "job1", status="processing", source_provider="upload")
        self.client.delete_object = _failing

        worker_module.cleanup_failed_job(get_job(self.db_path, "job1"), RuntimeError("engine"))

        self.assertEqual(get_job(self.db_path, "job1").status, "failed")

    def _run_loop_with_storage_errors(self, iterations: int) -> None:
        class StopLoop(Exception):
            pass

        sleeps: list[float] = []

        def fail_with_storage_error(*args):
            raise storage.StorageError("Analysis upload failed")

        def sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) >= iterations:
                raise StopLoop()

        with (
            patch.dict(worker_module._storage_failures, clear=True),
            patch.object(worker_module, "init_db"),
            patch.object(worker_module, "maybe_notify_youtube_failures"),
            patch.object(
                worker_module, "claim_next_job", side_effect=lambda db: get_job(self.db_path, "job1")
            ),
            patch.object(worker_module, "run_job", side_effect=fail_with_storage_error),
            patch.object(worker_module.time, "sleep", side_effect=sleep),
        ):
            with self.assertRaises(StopLoop):
                worker_module.run_worker_loop()
        self.assertEqual(sleeps, [worker_module.STORAGE_RETRY_DELAY_S] * iterations)

    def test_worker_requeues_job_on_storage_error_and_keeps_audio(self) -> None:
        create_job(self.db_path, "job1", status="processing", source_provider="upload")
        self.client._put("audio/job1", b"audio", None)

        self._run_loop_with_storage_errors(1)

        job = get_job(self.db_path, "job1")
        self.assertEqual((job.status, job.progress), ("queued", 25))
        self.assertIn("audio/job1", self.client.objects)

    def test_worker_fails_job_after_repeated_storage_errors_and_keeps_audio(self) -> None:
        create_job(self.db_path, "job1", status="processing", source_provider="upload")
        self.client._put("audio/job1", b"audio", None)

        self._run_loop_with_storage_errors(worker_module.STORAGE_RETRY_LIMIT)

        job = get_job(self.db_path, "job1")
        self.assertEqual(job.status, "failed")
        self.assertIn("audio/job1", self.client.objects)

    def test_bucket_errors_in_worker_raise_storage_error(self) -> None:
        self.client._put("audio/job1", b"audio", {"Metadata": {"ext": ".mp3"}})
        self.client.download_file = _failing
        with self.assertRaises(storage.StorageError):
            with self.store.local_audio("job1"):
                pass

        gz_path = self.root / "job1.json.gz"
        gz_path.write_bytes(gzip.compress(b"{}"))
        self.client.upload_file = _failing
        with self.assertRaises(storage.StorageError):
            self.store.save_analysis("job1", gz_path)

    def test_recycle_returns_owner_despite_bucket_errors(self) -> None:
        create_job(self.db_path, "job1", status="downloading", source_provider="youtube", source_id="abc")
        self.client.delete_object = _failing

        self.assertIsNotNone(jobs_runtime.recycle_job(get_job(self.db_path, "job1")))


class LocalWorkerTests(unittest.TestCase):
    def test_run_job_writes_gzipped_analysis_next_to_storage_and_keeps_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "audio" / "job1.m4a"
            audio.parent.mkdir()
            audio.write_bytes(b"audio")

            def fake_engine(job_id, input_abs, output_abs, env, title, artist):
                self.assertEqual(input_abs, audio)
                output_abs.write_text(json.dumps({"track": {"duration": 2.5}}))

            with (
                patch.dict(os.environ, {storage.STORAGE_BACKEND_ENV: "local"}),
                patch.object(worker_module, "STORAGE_ROOT", root),
                patch.object(worker_module, "ENGINE_REPO", root),
                patch.object(worker_module, "_run_engine", side_effect=fake_engine),
            ):
                duration = worker_module.run_job("job1")

            self.assertEqual(duration, 2.5)
            self.assertTrue(audio.exists())
            self.assertFalse((root / "analysis" / "job1.json").exists())
            with gzip.open(root / "analysis" / "job1.json.gz", "rt") as handle:
                self.assertEqual(json.load(handle), {"track": {"duration": 2.5}})


class TigrisWorkerTests(unittest.TestCase):
    def test_run_job_analyses_scratch_audio_and_uploads_result(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            client = FakeS3()
            store = S3Store("bucket", root / "scratch", client=client)
            client._put("audio/job1", b"remote", {"Metadata": {"ext": ".webm"}})
            seen_inputs: list[Path] = []

            def fake_engine(job_id, input_abs, output_abs, env, title, artist):
                seen_inputs.append(input_abs)
                output_abs.write_text(json.dumps({"track": {"duration": 3.0}}))

            with (
                patch.dict(os.environ, {storage.STORAGE_BACKEND_ENV: "tigris"}),
                patch.object(storage, "_tigris_store", return_value=store),
                patch.object(worker_module, "ENGINE_REPO", root),
                patch.object(worker_module, "_run_engine", side_effect=fake_engine),
            ):
                duration = worker_module.run_job("job1")

            self.assertEqual(seen_inputs[0].name, "job1.webm")
            self.assertEqual(store.read_analysis("job1"), {"track": {"duration": 3.0}})
            self.assertEqual(duration, 3.0)
            self.assertEqual(list((root / "scratch" / "audio").iterdir()), [])
            self.assertEqual(list((root / "scratch" / "analysis").iterdir()), [])


class SyncScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.root = Path(temp_dir.name) / "storage"
        (self.root / "audio").mkdir(parents=True)
        (self.root / "analysis").mkdir()
        self.client = FakeS3()
        self.store = S3Store("bucket", Path(temp_dir.name) / "scratch", client=self.client)

    def test_local_items_skip_transient_audio_and_include_legacy_json(self) -> None:
        (self.root / "audio" / "job1.webm").write_bytes(b"a")
        (self.root / "audio" / "job2.m4a.part").write_bytes(b"p")
        (self.root / "audio" / "job2.f251.webm").write_bytes(b"f")
        (self.root / "analysis" / "job1.json.gz").write_bytes(gzip.compress(b"{}"))
        (self.root / "analysis" / "job3.json").write_text("{}")

        keys = [item.key for item in sync.local_items(self.root)]

        self.assertEqual(keys, ["audio/job1", "analysis/job1.json.gz", "analysis/job3.json.gz"])

    def test_push_verify_and_pull_round_trip(self) -> None:
        (self.root / "audio" / "job1.webm").write_bytes(b"audio")
        (self.root / "analysis" / "job1.json").write_text('{"a": 1}')
        items = sync.local_items(self.root)

        outcomes = [sync.push_item(self.store, i, sync.remote_objects(self.store)) for i in items]
        remote = sync.remote_objects(self.store)
        again = [sync.push_item(self.store, i, remote) for i in items]

        self.assertEqual(outcomes, ["uploaded", "uploaded"])
        self.assertEqual(again, ["skipped", "skipped"])
        self.assertEqual(self.client.objects["audio/job1"]["Metadata"], {"ext": ".webm"})
        self.assertEqual([sync.verify_item(i, remote) for i in items], ["ok", "ok"])

        (self.root / "audio" / "job1.webm").write_bytes(b"changed")
        self.assertEqual(sync.verify_item(items[0], remote), "mismatch")

        repaired = sync.verify_item(items[0], remote, self.store)
        self.assertEqual(repaired, "repaired")
        self.assertEqual(self.client.objects["audio/job1"]["body"], b"changed")
        (self.root / "audio" / "job1.webm").write_bytes(b"audio")
        sync.upload_item(self.store, items[0])
        remote = sync.remote_objects(self.store)

        pulled = Path(self.root.parent / "pulled")
        results = [sync.pull_key(self.store, pulled, key, set()) for key in sorted(remote)]
        self.assertEqual(results, ["downloaded", "downloaded"])
        self.assertEqual((pulled / "audio" / "job1.webm").read_bytes(), b"audio")
        with gzip.open(pulled / "analysis" / "job1.json.gz", "rt") as handle:
            self.assertEqual(json.load(handle), {"a": 1})
        local_audio = set(sync.local_audio_files(pulled))
        self.assertEqual(sync.pull_key(self.store, pulled, "audio/job1", local_audio), "skipped")


class SyncPruneTests(unittest.TestCase):
    def test_orphans_are_remote_keys_without_local_files(self) -> None:
        items = [sync.LocalItem("audio/job1", Path("/x/job1.webm"), "audio")]
        remote = {"audio/job1": (1, "a"), "audio/gone": (1, "b"), "analysis/gone.json.gz": (1, "c")}

        self.assertEqual(sync.orphan_keys(items, remote), ["analysis/gone.json.gz", "audio/gone"])

    def _items(self, audio_count: int) -> list:
        return [
            sync.LocalItem(f"audio/job{i}", Path(f"/x/job{i}.webm"), "audio") for i in range(audio_count)
        ]

    def test_prune_refused_without_local_audio(self) -> None:
        remote = {"audio/job1": (1, "a")}
        self.assertIn("no local audio", sync.prune_refusal([], remote, ["audio/job1"]))

    def test_prune_refused_when_too_much_of_the_bucket_would_go(self) -> None:
        items = self._items(5)
        remote = {f"audio/job{i}": (1, "a") for i in range(10)}
        orphans = sync.orphan_keys(items, remote)

        self.assertIn("5 of 10", sync.prune_refusal(items, remote, orphans))
        self.assertIsNone(sync.prune_refusal(items, remote, orphans[:1]))

    def test_prune_dry_run_lists_keys_and_force_applies(self) -> None:
        client = FakeS3()
        for name in ("keep", "gone"):
            client._put(f"audio/{name}", b"x", None)
        store = S3Store("bucket", Path("/tmp/unused"), client=client)
        with tempfile.TemporaryDirectory() as temp_dir:
            (Path(temp_dir) / "audio").mkdir()
            (Path(temp_dir) / "audio" / "keep.webm").write_bytes(b"x")
            env = _env_without_backend()
            base = ["sync", "prune", "--storage-root", temp_dir]
            with (
                patch.object(sync, "tigris_store_from_env", return_value=store),
                patch.dict(os.environ, env, clear=True),
            ):
                output = io.StringIO()
                with patch.object(sync.sys, "argv", base), redirect_stdout(output):
                    self.assertEqual(sync.main(), 1)
                self.assertIn("  audio/gone", output.getvalue())
                self.assertIn("prune refused", output.getvalue())

                with patch.object(sync.sys, "argv", [*base, "--apply", "--force"]), redirect_stdout(
                    io.StringIO()
                ):
                    self.assertEqual(sync.main(), 0)
        self.assertEqual(sorted(client.objects), ["audio/keep"])

    def test_prune_is_refused_while_the_bucket_is_live(self) -> None:
        client = FakeS3()
        client._put("audio/gone", b"x", None)
        store = S3Store("bucket", Path("/tmp/unused"), client=client)
        with tempfile.TemporaryDirectory() as temp_dir:
            argv = ["sync", "prune", "--apply", "--storage-root", temp_dir]
            with (
                patch.object(sync.sys, "argv", argv),
                patch.object(sync, "tigris_store_from_env", return_value=store),
                patch.dict(os.environ, {storage.STORAGE_BACKEND_ENV: "tigris"}),
            ):
                self.assertEqual(sync.main(), 1)
        self.assertIn("audio/gone", client.objects)


if __name__ == "__main__":
    unittest.main()
