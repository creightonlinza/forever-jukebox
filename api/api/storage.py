"""Audio and analysis storage backends.

Local disk is the default. STORAGE_BACKEND=s3 keeps audio and analysis in an
S3-compatible bucket instead (for example Tigris on Fly, whose `fly storage create` sets
BUCKET_NAME, AWS_ENDPOINT_URL_S3 and the AWS_* credentials this reads).
Logs and the SQLite databases always stay on local disk.
"""

from __future__ import annotations

import gzip
import json
import mimetypes
import os
import shutil
import sqlite3
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, Iterator

# The worker imports this module from the engine venv, which has no fastapi.
if TYPE_CHECKING:
    from fastapi.responses import Response

from .utils import (
    analysis_path_for,
    audio_path_for,
    get_logger,
    read_analysis_json,
    resolve_analysis_path,
)

STORAGE_BACKEND_ENV = "STORAGE_BACKEND"
PRESIGNED_URL_TTL_S = 600
# Above the 100 MB download cap, so every object is single-part and its ETag is its MD5.
MULTIPART_THRESHOLD_BYTES = 256 * 1024 * 1024
BACKUP_MAX_AGE_S = 24 * 3600
_MISSING_CODES = {"404", "NoSuchKey", "NotFound"}
logger = get_logger()


class StorageError(RuntimeError):
    """A bucket read or write failed; the job's stored files are not at fault."""


def _remove_files(directory: Path, job_id: str) -> None:
    for candidate in directory.glob(f"{job_id}.*"):
        if candidate.is_file():
            candidate.unlink()


class LocalStore:
    """Files under storage/audio and storage/analysis."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def audio_dir(self) -> Path:
        return self.root / "audio"

    def save_audio(self, job_id: str, path: Path) -> None:
        """Downloads and uploads already land at their final local path."""

    def has_audio(self, job_id: str) -> bool:
        return audio_path_for(self.root, job_id) is not None

    @contextmanager
    def local_audio(self, job_id: str) -> Iterator[Path | None]:
        yield audio_path_for(self.root, job_id)

    def audio_response(self, job_id: str) -> Response | None:
        path = audio_path_for(self.root, job_id)
        if path is None or not path.exists():
            return None
        from fastapi.responses import FileResponse

        # Identity encoding keeps GZipMiddleware off the audio, so the client gets a Content-Length for progress.
        return FileResponse(path=str(path), headers={"Content-Encoding": "identity"})

    def analysis_output_path(self, job_id: str) -> Path:
        return analysis_path_for(self.root, job_id)

    def save_analysis(self, job_id: str, gz_path: Path) -> None:
        """The worker already writes the gzipped result to its final local path."""

    def has_analysis(self, job_id: str) -> bool:
        return resolve_analysis_path(self.root, job_id).exists()

    def read_analysis(self, job_id: str) -> Any | None:
        path = resolve_analysis_path(self.root, job_id)
        if not path.exists():
            return None
        return read_analysis_json(path)

    def analysis_mtime(self, job_id: str) -> datetime | None:
        path = resolve_analysis_path(self.root, job_id)
        if not path.exists():
            return None
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)

    def delete_audio(self, job_id: str) -> None:
        _remove_files(self.root / "audio", job_id)

    def delete_analysis(self, job_id: str) -> None:
        _remove_files(self.root / "analysis", job_id)

    def artifact_bytes(self, job_ids: Iterable[str]) -> dict[str, int]:
        sizes: dict[str, int] = {}
        for job_id in job_ids:
            total = 0
            for directory in (self.root / "audio", self.root / "analysis"):
                for path in directory.glob(f"{job_id}.*"):
                    try:
                        if path.is_file():
                            total += path.stat().st_size
                    except OSError:
                        continue
            sizes[job_id] = total
        return sizes


def audio_key(job_id: str) -> str:
    return f"audio/{job_id}"


def analysis_key(job_id: str) -> str:
    return f"analysis/{job_id}.json.gz"


def backup_key(name: str) -> str:
    return f"backups/{name}.gz"


def _is_missing(exc: Exception) -> bool:
    error = getattr(exc, "response", None) or {}
    return str(error.get("Error", {}).get("Code")) in _MISSING_CODES


class S3Store:
    """Objects in an S3-compatible bucket, with a local scratch dir for files in flight.

    Audio is keyed without its extension so existence is one HEAD; the original
    extension is kept in the object's `ext` metadata. Deletes are plain deletes, so
    the bucket must not keep object versions (or bucket snapshots) to free space.
    """

    def __init__(self, bucket: str, scratch: Path, client: Any = None) -> None:
        self.bucket = bucket
        self.scratch = scratch
        self._client_instance = client
        self._client_lock = threading.Lock()

    @property
    def client(self) -> Any:
        # Created once on first use; concurrent API threadpool requests can race here.
        with self._client_lock:
            if self._client_instance is None:
                import boto3
                from botocore.config import Config

                self._client_instance = boto3.session.Session().client(
                    "s3",
                    endpoint_url=os.environ["AWS_ENDPOINT_URL_S3"],
                    region_name=os.environ.get("AWS_REGION") or "auto",
                    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
                )
            return self._client_instance

    def _upload(self, path: Path, key: str, extra: dict[str, Any]) -> None:
        from boto3.s3.transfer import TransferConfig

        self.client.upload_file(
            str(path),
            self.bucket,
            key,
            ExtraArgs=extra,
            Config=TransferConfig(multipart_threshold=MULTIPART_THRESHOLD_BYTES),
        )

    def _head(self, key: str) -> dict[str, Any] | None:
        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if _is_missing(exc):
                return None
            raise

    def audio_dir(self) -> Path:
        return self.scratch / "audio"

    def save_audio(self, job_id: str, path: Path) -> None:
        """Upload finished audio; the scratch copy stays for the worker to reuse."""
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self._upload(
            path,
            audio_key(job_id),
            {"ContentType": content_type, "Metadata": {"ext": path.suffix}},
        )

    def has_audio(self, job_id: str) -> bool:
        return self._head(audio_key(job_id)) is not None

    @contextmanager
    def local_audio(self, job_id: str) -> Iterator[Path | None]:
        """Scratch copy of the audio, fetched from the bucket if needed, removed afterwards."""
        try:
            path = audio_path_for(self.scratch, job_id)
            if path is None:
                try:
                    head = self._head(audio_key(job_id))
                    if head is not None:
                        ext = (head.get("Metadata") or {}).get("ext", "")
                        path = self.audio_dir() / f"{job_id}{ext}"
                        path.parent.mkdir(parents=True, exist_ok=True)
                        self.client.download_file(self.bucket, audio_key(job_id), str(path))
                except Exception as exc:
                    raise StorageError(f"Audio download failed: {exc}") from exc
            yield path
        finally:
            _remove_files(self.audio_dir(), job_id)

    def audio_response(self, job_id: str) -> Response | None:
        url = self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": audio_key(job_id)},
            ExpiresIn=PRESIGNED_URL_TTL_S,
        )
        from fastapi.responses import RedirectResponse

        return RedirectResponse(url, status_code=307, headers={"Cache-Control": "no-store"})

    def analysis_output_path(self, job_id: str) -> Path:
        return analysis_path_for(self.scratch, job_id)

    def save_analysis(self, job_id: str, gz_path: Path) -> None:
        try:
            self._upload(gz_path, analysis_key(job_id), {"ContentType": "application/gzip"})
        except Exception as exc:
            raise StorageError(f"Analysis upload failed: {exc}") from exc
        gz_path.unlink()

    def has_analysis(self, job_id: str) -> bool:
        return self._head(analysis_key(job_id)) is not None

    def read_analysis(self, job_id: str) -> Any | None:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=analysis_key(job_id))
        except Exception as exc:
            if _is_missing(exc):
                return None
            raise
        return json.loads(gzip.decompress(response["Body"].read()))

    def analysis_mtime(self, job_id: str) -> datetime | None:
        head = self._head(analysis_key(job_id))
        return head["LastModified"] if head else None

    def delete_audio(self, job_id: str) -> None:
        _remove_files(self.audio_dir(), job_id)
        self.client.delete_object(Bucket=self.bucket, Key=audio_key(job_id))

    def delete_analysis(self, job_id: str) -> None:
        _remove_files(self.scratch / "analysis", job_id)
        self.client.delete_object(Bucket=self.bucket, Key=analysis_key(job_id))

    def backup_mtime(self, name: str) -> datetime | None:
        head = self._head(backup_key(name))
        return head["LastModified"] if head else None

    def save_backup(self, name: str, gz_path: Path) -> None:
        self._upload(gz_path, backup_key(name), {"ContentType": "application/gzip"})

    def artifact_bytes(self, job_ids: Iterable[str]) -> dict[str, int]:
        sizes = dict.fromkeys(job_ids, 0)
        if not sizes:
            return sizes
        paginator = self.client.get_paginator("list_objects_v2")
        for prefix in ("audio/", "analysis/"):
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for obj in page.get("Contents", []):
                    job_id = obj["Key"][len(prefix):].removesuffix(".json.gz")
                    if job_id in sizes:
                        sizes[job_id] += int(obj["Size"])
        return sizes


Store = LocalStore | S3Store


def discard_job_files(store: Store, job_id: str, *, analysis: bool = True) -> None:
    """Delete a job's files on a failure path; bucket errors are logged, local errors raise."""
    deletes = [store.delete_audio, store.delete_analysis] if analysis else [store.delete_audio]
    for delete in deletes:
        try:
            delete(job_id)
        except Exception:
            if isinstance(store, LocalStore):
                raise
            logger.warning("Could not delete stored files for job %s", job_id, exc_info=True)


def _snapshot_sqlite(db_path: Path, snapshot_path: Path) -> None:
    """Consistent copy of a live SQLite database, checked before it is uploaded."""
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(snapshot_path)
    try:
        src.backup(dst)
        result = dst.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        dst.close()
        src.close()
    if result != "ok":
        raise RuntimeError(f"{db_path.name} snapshot failed quick_check: {result}")


def _backup_database(store: S3Store, db_path: Path, now: datetime) -> bool:
    if not db_path.is_file():
        return False
    last = store.backup_mtime(db_path.name)
    if last is not None and (now - last).total_seconds() < BACKUP_MAX_AGE_S:
        return False
    work_dir = store.scratch / "backups"
    work_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = work_dir / db_path.name
    gz_path = work_dir / f"{db_path.name}.gz"
    try:
        _remove_files(work_dir, db_path.stem)
        _snapshot_sqlite(db_path, snapshot_path)
        with snapshot_path.open("rb") as src, gzip.open(gz_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
        store.save_backup(db_path.name, gz_path)
    finally:
        _remove_files(work_dir, db_path.stem)
    return True


def backup_databases(
    store: S3Store, db_paths: Iterable[Path], *, now: datetime | None = None
) -> list[str]:
    """Snapshot each database into the bucket when its backup is a day old.

    Each database has one object, `backups/<name>.gz`, replaced in place; keeping history is
    left to whatever mirrors the bucket. A failure is logged and doesn't stop the others.
    Returns the names saved.
    """
    now = now or datetime.now(timezone.utc)
    saved: list[str] = []
    for db_path in db_paths:
        try:
            if _backup_database(store, db_path, now):
                saved.append(db_path.name)
        except Exception:
            logger.warning("Database backup failed for %s", db_path.name, exc_info=True)
    return saved


def s3_store_from_env() -> S3Store:
    required = ("BUCKET_NAME", "AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        raise RuntimeError(f"STORAGE_BACKEND=s3 requires {', '.join(missing)}")
    bucket = os.environ["BUCKET_NAME"].strip()
    return S3Store(bucket, Path(tempfile.gettempdir()) / "forever-jukebox")


@lru_cache(maxsize=1)
def _s3_store() -> S3Store:
    return s3_store_from_env()


def get_store(storage_root: Path) -> Store:
    """Store selected by STORAGE_BACKEND: unset or "local" keeps files under storage_root."""
    backend = (os.environ.get(STORAGE_BACKEND_ENV) or "local").strip().lower()
    if backend == "local":
        return LocalStore(storage_root)
    if backend == "s3":
        return _s3_store()
    raise RuntimeError(f"Unsupported {STORAGE_BACKEND_ENV}: {backend!r}")
