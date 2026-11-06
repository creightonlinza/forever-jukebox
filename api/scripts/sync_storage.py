#!/usr/bin/env python3
"""Copy audio and analysis between local storage and an S3-compatible bucket.

    push    upload local files that are missing or differently sized in the bucket
    verify  check every local file has an object with the same size and MD5 (ETag);
            with --repair, re-upload missing and mismatched files
    prune   list objects with no local file (jobs deleted since an earlier push);
            with --apply, delete them. Refused while STORAGE_BACKEND is anything but local,
            when there is no local audio, or when more than 10% of the bucket would go (--force overrides
            the last two).
    pull    download objects that are missing locally (switching back to local storage)

Uses the same keys as STORAGE_BACKEND=s3. Reads BUCKET_NAME, AWS_ENDPOINT_URL_S3,
AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY; STORAGE_BACKEND itself need not be set.
Legacy plain .json analysis is gzipped on upload. Safe to re-run.

Usage (from api/):
    python scripts/sync_storage.py {push,verify,prune,pull} [--repair] [--apply]
        [--force] [--storage-root PATH] [--workers N]
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Callable, Iterable

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from api.storage import S3Store, analysis_key, audio_key, s3_store_from_env  # noqa: E402
from api.utils import is_finished_audio, resolve_analysis_path  # noqa: E402

DEFAULT_STORAGE_ROOT = APP_ROOT / "storage"
# prune deletes at most this share of the bucket without --force.
PRUNE_MAX_FRACTION = 0.10
PRUNE_PREVIEW_KEYS = 20


@dataclass
class LocalItem:
    key: str
    path: Path
    kind: str  # "audio" or "analysis"

    @cached_property
    def gzipped_legacy(self) -> bytes | None:
        """Gzipped bytes for legacy plain .json analysis; None when the file uploads as is."""
        if self.kind == "analysis" and self.path.suffix != ".gz":
            return gzip.compress(self.path.read_bytes(), mtime=0)
        return None

    def size(self) -> int:
        legacy = self.gzipped_legacy
        return len(legacy) if legacy is not None else self.path.stat().st_size

    def md5(self) -> str:
        legacy = self.gzipped_legacy
        if legacy is not None:
            return hashlib.md5(legacy).hexdigest()
        digest = hashlib.md5()
        with self.path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()


def local_audio_files(storage_root: Path) -> dict[str, Path]:
    """Finished audio by job id, from one directory scan."""
    files: dict[str, Path] = {}
    for path in sorted((storage_root / "audio").glob("*")):
        job_id = path.name.split(".", 1)[0]
        if is_finished_audio(path, job_id):
            files[job_id] = path
    return files


def local_items(storage_root: Path) -> list[LocalItem]:
    items = [
        LocalItem(audio_key(job_id), path, "audio")
        for job_id, path in local_audio_files(storage_root).items()
    ]
    job_ids = {p.name.split(".", 1)[0] for p in (storage_root / "analysis").glob("*.json*")}
    for job_id in sorted(job_ids):
        path = resolve_analysis_path(storage_root, job_id)
        if path.is_file():
            items.append(LocalItem(analysis_key(job_id), path, "analysis"))
    return items


def remote_objects(store: S3Store) -> dict[str, tuple[int, str]]:
    objects: dict[str, tuple[int, str]] = {}
    paginator = store.client.get_paginator("list_objects_v2")
    for prefix in ("audio/", "analysis/"):
        for page in paginator.paginate(Bucket=store.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                objects[obj["Key"]] = (int(obj["Size"]), obj["ETag"].strip('"'))
    return objects


def upload_item(store: S3Store, item: LocalItem) -> None:
    if item.kind == "audio":
        store.save_audio(item.key.split("/", 1)[1], item.path)
        return
    legacy = item.gzipped_legacy
    body = legacy if legacy is not None else item.path.read_bytes()
    store.client.put_object(
        Bucket=store.bucket, Key=item.key, Body=body, ContentType="application/gzip"
    )


def push_item(store: S3Store, item: LocalItem, remote: dict[str, tuple[int, str]]) -> str:
    if remote.get(item.key, (None,))[0] == item.size():
        return "skipped"
    upload_item(store, item)
    return "uploaded"


def verify_item(
    item: LocalItem,
    remote: dict[str, tuple[int, str]],
    repair_store: S3Store | None = None,
) -> str:
    if item.key not in remote:
        outcome = "missing"
    else:
        size, etag = remote[item.key]
        if size == item.size() and etag == item.md5():
            return "ok"
        outcome = "mismatch"
    if repair_store is None:
        return outcome
    upload_item(repair_store, item)
    return "repaired"


def prune_key(store: S3Store, key: str) -> str:
    store.client.delete_object(Bucket=store.bucket, Key=key)
    return "pruned"


def prune_refusal(
    items: list[LocalItem], remote: dict[str, tuple[int, str]], orphans: list[str]
) -> str | None:
    """Why pruning looks like the wrong storage root or a live bucket, if it does."""
    if not any(item.kind == "audio" for item in items):
        return "no local audio files (wrong --storage-root, or storage already moved?)"
    if remote and len(orphans) > PRUNE_MAX_FRACTION * len(remote):
        return f"{len(orphans)} of {len(remote)} objects would be deleted"
    return None


def orphan_keys(items: list[LocalItem], remote: dict[str, tuple[int, str]]) -> list[str]:
    local_keys = {item.key for item in items}
    return sorted(key for key in remote if key not in local_keys)


def pull_key(store: S3Store, storage_root: Path, key: str, local_audio: set[str]) -> str:
    kind, name = key.split("/", 1)
    if kind == "audio":
        if name in local_audio:
            return "skipped"
        head = store.client.head_object(Bucket=store.bucket, Key=key)
        ext = (head.get("Metadata") or {}).get("ext", "")
        target = storage_root / "audio" / f"{name}{ext}"
    else:
        job_id = name.removesuffix(".json.gz")
        if resolve_analysis_path(storage_root, job_id).exists():
            return "skipped"
        target = storage_root / "analysis" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    store.client.download_file(store.bucket, key, str(target))
    return "downloaded"


def run_all(label: str, tasks: Iterable[tuple[str, Callable[[], str]]], workers: int) -> dict[str, int]:
    counts: dict[str, int] = {}
    tasks = list(tasks)

    def run(task: tuple[str, Callable[[], str]]) -> tuple[str, str]:
        name, fn = task
        try:
            return name, fn()
        except Exception as exc:  # noqa: BLE001 - report and continue
            return name, f"error: {exc}"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for index, (name, outcome) in enumerate(pool.map(run, tasks), start=1):
            bucket = outcome if not outcome.startswith("error") else "error"
            counts[bucket] = counts.get(bucket, 0) + 1
            if bucket not in {"ok", "skipped", "uploaded", "downloaded", "pruned"}:
                print(f"{name}: {outcome}", flush=True)
            if index % 500 == 0:
                print(f"{label}: {index}/{len(tasks)} {counts}", flush=True)
    print(f"{label}: done {counts}", flush=True)
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["push", "verify", "prune", "pull"])
    parser.add_argument("--repair", action="store_true", help="verify: re-upload bad files")
    parser.add_argument("--apply", action="store_true", help="prune: delete the orphans")
    parser.add_argument("--force", action="store_true", help="prune: skip the size checks")
    parser.add_argument("--storage-root", type=Path, default=DEFAULT_STORAGE_ROOT)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    store = s3_store_from_env()
    root = args.storage_root.resolve()
    remote = remote_objects(store)
    print(f"bucket {store.bucket}: {len(remote)} objects", flush=True)

    if args.command == "pull":
        local_audio = set(local_audio_files(root))
        tasks = [
            (key, lambda key=key: pull_key(store, root, key, local_audio)) for key in sorted(remote)
        ]
        counts = run_all("pull", tasks, args.workers)
        return 1 if counts.get("error") else 0

    items = local_items(root)
    print(f"{root}: {len(items)} local files", flush=True)
    if args.command == "push":
        tasks = [(str(i.path), lambda i=i: push_item(store, i, remote)) for i in items]
        counts = run_all("push", tasks, args.workers)
        return 1 if counts.get("error") else 0
    if args.command == "prune":
        backend = (os.environ.get("STORAGE_BACKEND") or "local").strip().lower()
        if backend != "local":
            print(f"prune refused: the bucket may be live (STORAGE_BACKEND={backend})", flush=True)
            return 1
        orphans = orphan_keys(items, remote)
        audio_orphans = sum(1 for key in orphans if key.startswith("audio/"))
        print(
            f"prune: {len(orphans)} of {len(remote)} objects have no local file "
            f"({audio_orphans} audio, {len(orphans) - audio_orphans} analysis)",
            flush=True,
        )
        for key in orphans[:PRUNE_PREVIEW_KEYS]:
            print(f"  {key}", flush=True)
        if len(orphans) > PRUNE_PREVIEW_KEYS:
            print(f"  ... and {len(orphans) - PRUNE_PREVIEW_KEYS} more", flush=True)
        refusal = prune_refusal(items, remote, orphans)
        if refusal and not args.force:
            print(f"prune refused: {refusal}; pass --force if this is expected", flush=True)
            return 1
        if not args.apply:
            print("prune: dry run; pass --apply to delete them", flush=True)
            return 0
        tasks = [(key, lambda key=key: prune_key(store, key)) for key in orphans]
        counts = run_all("prune", tasks, args.workers)
        return 1 if counts.get("error") else 0
    repair_store = store if args.repair else None
    tasks = [(str(i.path), lambda i=i: verify_item(i, remote, repair_store)) for i in items]
    counts = run_all("verify", tasks, args.workers)
    return 0 if set(counts) <= {"ok", "repaired"} else 1


if __name__ == "__main__":
    sys.exit(main())
