"""Manual storage cleanup for cold completed jobs."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .db import _connect, delete_job
from .models import StorageCleanupError, StorageCleanupResponse, StorageCleanupSampleItem
from .routes.jobs_runtime import delete_job_artifacts
from .utils import abs_storage_path


CLEANUP_POLICY_DAYS = 90
CLEANUP_POLICY_PLAY_COUNT_BELOW = 3
SAMPLE_SIZE = 10


@dataclass(frozen=True)
class CleanupCandidate:
    job_id: str
    input_path: str
    output_path: str
    provider: str
    source_id: str | None
    source_url: str | None
    title: str | None
    artist: str | None
    play_count: int
    updated_at: str


def _cutoff_arg(days: int) -> str:
    return f"-{max(1, int(days))} days"


def _candidate_from_row(row: tuple) -> CleanupCandidate:
    return CleanupCandidate(
        job_id=str(row[0]),
        input_path=str(row[1] or ""),
        output_path=str(row[2] or ""),
        provider=str(row[3] or ""),
        source_id=str(row[4]) if row[4] is not None else None,
        source_url=str(row[5]) if row[5] is not None else None,
        title=str(row[6]) if row[6] is not None else None,
        artist=str(row[7]) if row[7] is not None else None,
        play_count=int(row[8] or 0),
        updated_at=str(row[9] or ""),
    )


def find_cleanup_candidates(db_path: Path) -> list[CleanupCandidate]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
              j.id,
              j.input_path,
              j.output_path,
              s.provider,
              s.source_id,
              s.source_url,
              s.track_title,
              s.track_artist,
              s.play_count,
              s.updated_at
            FROM jobs j
            JOIN sources s ON s.id = j.source_ref
            WHERE j.status = 'complete'
              AND s.play_count < ?
              AND julianday(s.updated_at) < julianday('now', ?)
            ORDER BY s.updated_at ASC, j.id ASC
            """,
            (CLEANUP_POLICY_PLAY_COUNT_BELOW, _cutoff_arg(CLEANUP_POLICY_DAYS)),
        ).fetchall()
    return [_candidate_from_row(row) for row in rows]


def find_cleanup_candidate_by_id(
    db_path: Path,
    job_id: str,
) -> CleanupCandidate | None:
    with _connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT
              j.id,
              j.input_path,
              j.output_path,
              s.provider,
              s.source_id,
              s.source_url,
              s.track_title,
              s.track_artist,
              s.play_count,
              s.updated_at
            FROM jobs j
            JOIN sources s ON s.id = j.source_ref
            WHERE j.id = ?
              AND j.status = 'complete'
              AND s.play_count < ?
              AND julianday(s.updated_at) < julianday('now', ?)
            """,
            (job_id, CLEANUP_POLICY_PLAY_COUNT_BELOW, _cutoff_arg(CLEANUP_POLICY_DAYS)),
        ).fetchone()
    return _candidate_from_row(row) if row else None


def artifact_paths(storage_root: Path, candidate: CleanupCandidate) -> list[Path]:
    paths: list[Path] = []
    if candidate.input_path:
        paths.append(abs_storage_path(storage_root, candidate.input_path))
    if candidate.output_path:
        paths.append(abs_storage_path(storage_root, candidate.output_path))
    paths.append(storage_root / "logs" / f"{candidate.job_id}.log")
    paths.extend((storage_root / "audio").glob(f"{candidate.job_id}.*"))
    paths.extend((storage_root / "analysis").glob(f"{candidate.job_id}.*"))

    unique_paths: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique_paths.append(path)
    return unique_paths


def candidate_bytes(storage_root: Path, candidate: CleanupCandidate) -> int:
    total = 0
    for path in artifact_paths(storage_root, candidate):
        if not path.is_file():
            continue
        try:
            total += path.stat().st_size
        except OSError:
            continue
    return total


def build_cleanup_preview(db_path: Path, storage_root: Path) -> StorageCleanupResponse:
    candidates = find_cleanup_candidates(db_path)
    bytes_by_job = {
        candidate.job_id: candidate_bytes(storage_root, candidate)
        for candidate in candidates
    }
    sample = [
        StorageCleanupSampleItem(
            job_id=candidate.job_id,
            provider=candidate.provider,
            source_id=candidate.source_id,
            source_url=candidate.source_url,
            title=candidate.title,
            artist=candidate.artist,
            play_count=candidate.play_count,
            updated_at=candidate.updated_at,
            bytes=bytes_by_job[candidate.job_id],
        )
        for candidate in candidates[:SAMPLE_SIZE]
    ]
    return StorageCleanupResponse(
        dry_run=True,
        days=CLEANUP_POLICY_DAYS,
        play_count_below=CLEANUP_POLICY_PLAY_COUNT_BELOW,
        candidate_jobs=len(candidates),
        candidate_bytes=sum(bytes_by_job.values()),
        sample=sample,
        deleted_jobs=0,
        deleted_bytes=0,
        failed_jobs=0,
        errors=[],
    )


def execute_cleanup(db_path: Path, storage_root: Path) -> StorageCleanupResponse:
    preview = build_cleanup_preview(db_path, storage_root)
    candidates = find_cleanup_candidates(db_path)
    deleted_jobs = 0
    deleted_bytes = 0
    errors: list[StorageCleanupError] = []

    for candidate in candidates:
        eligible = find_cleanup_candidate_by_id(
            db_path,
            candidate.job_id,
        )
        if not eligible:
            continue

        bytes_to_delete = candidate_bytes(storage_root, eligible)
        try:
            delete_job_artifacts(eligible.job_id, eligible, storage_root)
            delete_job(db_path, eligible.job_id)
        except Exception as exc:  # noqa: BLE001 - cleanup should report and continue.
            errors.append(
                StorageCleanupError(
                    job_id=eligible.job_id,
                    error=str(exc) or exc.__class__.__name__,
                )
            )
            continue

        deleted_jobs += 1
        deleted_bytes += bytes_to_delete

    return StorageCleanupResponse(
        dry_run=False,
        days=CLEANUP_POLICY_DAYS,
        play_count_below=CLEANUP_POLICY_PLAY_COUNT_BELOW,
        candidate_jobs=preview.candidate_jobs,
        candidate_bytes=preview.candidate_bytes,
        sample=[],
        deleted_jobs=deleted_jobs,
        deleted_bytes=deleted_bytes,
        failed_jobs=len(errors),
        errors=errors,
    )
