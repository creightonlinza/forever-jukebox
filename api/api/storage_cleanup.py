"""Manual storage cleanup for cold completed jobs.

Deletes the artifacts and the job and source rows, so a cleaned-up track is gone
for good: shared links stop resolving and a later request creates a new job with
a freshly picked source. Tracks that were never opened are eligible after a short
grace period; everything else waits out the full dormancy window. Every provider
is eligible, uploads included.

Favorites key on job id, so each run also prunes favorite entries whose job is
gone, including ones left behind by earlier admin deletes.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .db import _connect, delete_job
from .favorites_db import prune_orphaned_favorites
from .models import StorageCleanupCandidateItem, StorageCleanupError, StorageCleanupResponse
from .routes.jobs_runtime import delete_job_artifacts
from .storage import get_store


CLEANUP_POLICY_DAYS = 365
ZERO_PLAY_GRACE_DAYS = 7

_DORMANT_OR_NEVER_OPENED_SQL = """
              j.status = 'complete'
              AND (
                julianday(s.updated_at) < julianday('now', ?)
                OR (
                  s.play_count = 0
                  AND julianday(s.updated_at) < julianday('now', ?)
                )
              )
"""

_NEVER_OPENED_SQL = """
              j.status = 'complete'
              AND s.play_count = 0
              AND julianday(s.updated_at) < julianday('now', ?)
"""


@dataclass(frozen=True)
class CleanupCandidate:
    job_id: str
    provider: str
    source_id: str | None
    source_url: str | None
    title: str | None
    artist: str | None
    play_count: int
    updated_at: str


def _cutoff_arg(days: int) -> str:
    return f"-{max(1, int(days))} days"


def _eligibility(days: int, zero_plays_only: bool) -> tuple[str, tuple[str, ...]]:
    """SQL and params for both the scan and the pre-delete re-check.

    One source for both, so a flag can never apply to the scan alone and leave
    the re-check rejecting everything it selected. `days` does not apply when
    only never-opened tracks are eligible; the grace period is the whole gate.
    """
    if zero_plays_only:
        return _NEVER_OPENED_SQL, (_cutoff_arg(ZERO_PLAY_GRACE_DAYS),)
    return (
        _DORMANT_OR_NEVER_OPENED_SQL,
        (_cutoff_arg(days), _cutoff_arg(ZERO_PLAY_GRACE_DAYS)),
    )


def _candidate_from_row(row: tuple) -> CleanupCandidate:
    return CleanupCandidate(
        job_id=str(row[0]),
        provider=str(row[1] or ""),
        source_id=str(row[2]) if row[2] is not None else None,
        source_url=str(row[3]) if row[3] is not None else None,
        title=str(row[4]) if row[4] is not None else None,
        artist=str(row[5]) if row[5] is not None else None,
        play_count=int(row[6] or 0),
        updated_at=str(row[7] or ""),
    )


def find_cleanup_candidates(
    db_path: Path,
    days: int = CLEANUP_POLICY_DAYS,
    *,
    zero_plays_only: bool = False,
) -> list[CleanupCandidate]:
    predicate, params = _eligibility(days, zero_plays_only)
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
              j.id,
              s.provider,
              s.source_id,
              s.source_url,
              s.track_title,
              s.track_artist,
              s.play_count,
              s.updated_at
            FROM jobs j
            JOIN sources s ON s.id = j.source_ref
            WHERE """
            + predicate
            + """
            ORDER BY s.updated_at ASC, j.id ASC
            """,
            params,
        ).fetchall()
    return [_candidate_from_row(row) for row in rows]


def find_cleanup_candidate_by_id(
    db_path: Path,
    job_id: str,
    days: int = CLEANUP_POLICY_DAYS,
    *,
    zero_plays_only: bool = False,
) -> CleanupCandidate | None:
    predicate, params = _eligibility(days, zero_plays_only)
    with _connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT
              j.id,
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
              AND """
            + predicate,
            (job_id, *params),
        ).fetchone()
    return _candidate_from_row(row) if row else None


def _live_job_ids(db_path: Path) -> set[str]:
    with _connect(db_path) as conn:
        return {str(row[0]) for row in conn.execute("SELECT id FROM jobs")}


def _has_jobs(db_path: Path) -> bool:
    with _connect(db_path) as conn:
        return conn.execute("SELECT 1 FROM jobs LIMIT 1").fetchone() is not None


def _prune_error(exc: Exception) -> StorageCleanupError:
    return StorageCleanupError(
        job_id="favorites",
        error=f"favorites prune failed: {str(exc) or exc.__class__.__name__}",
    )


def _log_bytes(storage_root: Path, job_id: str) -> int:
    log_path = storage_root / "logs" / f"{job_id}.log"
    try:
        return log_path.stat().st_size if log_path.is_file() else 0
    except OSError:
        return 0


def _candidate_item(candidate: CleanupCandidate) -> StorageCleanupCandidateItem:
    return StorageCleanupCandidateItem(
        job_id=candidate.job_id,
        provider=candidate.provider,
        source_id=candidate.source_id,
        source_url=candidate.source_url,
        title=candidate.title,
        artist=candidate.artist,
        play_count=candidate.play_count,
        updated_at=candidate.updated_at,
    )


def _candidates_with_size(
    db_path: Path,
    storage_root: Path,
    days: int,
    *,
    zero_plays_only: bool,
) -> list[tuple[CleanupCandidate, int]]:
    """Eligible candidates paired with the bytes their artifacts still occupy."""
    candidates = find_cleanup_candidates(db_path, days, zero_plays_only=zero_plays_only)
    sizes = get_store(storage_root).artifact_bytes([c.job_id for c in candidates])
    return [
        (
            candidate,
            _log_bytes(storage_root, candidate.job_id) + sizes.get(candidate.job_id, 0),
        )
        for candidate in candidates
    ]


def build_cleanup_preview(
    db_path: Path,
    storage_root: Path,
    days: int = CLEANUP_POLICY_DAYS,
    favorites_db_path: Path | None = None,
    *,
    zero_plays_only: bool = False,
) -> StorageCleanupResponse:
    pairs = _candidates_with_size(db_path, storage_root, days, zero_plays_only=zero_plays_only)
    orphaned_favorites = 0
    errors: list[StorageCleanupError] = []
    if favorites_db_path is not None:
        live = _live_job_ids(db_path)
        # Counts what the matching execute would prune, this run's deletions included.
        if live:
            try:
                orphaned_favorites = prune_orphaned_favorites(
                    favorites_db_path,
                    live - {candidate.job_id for candidate, _ in pairs},
                    apply=False,
                )
            except Exception as exc:  # noqa: BLE001 - the candidate list is still worth returning.
                errors.append(_prune_error(exc))
    return StorageCleanupResponse(
        dry_run=True,
        days=days,
        zero_play_days=ZERO_PLAY_GRACE_DAYS,
        zero_plays_only=zero_plays_only,
        candidate_jobs=len(pairs),
        candidate_bytes=sum(size for _, size in pairs),
        candidates=[_candidate_item(candidate) for candidate, _ in pairs],
        orphaned_favorites=orphaned_favorites,
        deleted_jobs=0,
        freed_bytes=0,
        pruned_favorites=0,
        failed_jobs=0,
        errors=errors,
    )


def execute_cleanup(
    db_path: Path,
    storage_root: Path,
    days: int = CLEANUP_POLICY_DAYS,
    favorites_db_path: Path | None = None,
    *,
    zero_plays_only: bool = False,
) -> StorageCleanupResponse:
    pairs = _candidates_with_size(db_path, storage_root, days, zero_plays_only=zero_plays_only)
    # Judged before the deletions: an empty jobs table makes every favorite look
    # orphaned, and a restored or lost jobs.db must not empty the sync lists.
    prunable = favorites_db_path is not None and _has_jobs(db_path)
    deleted_jobs = 0
    freed_bytes = 0
    errors: list[StorageCleanupError] = []

    for candidate, size in pairs:
        if not find_cleanup_candidate_by_id(
            db_path, candidate.job_id, days, zero_plays_only=zero_plays_only
        ):
            continue
        try:
            delete_job_artifacts(candidate.job_id, storage_root)
            delete_job(db_path, candidate.job_id)
        except Exception as exc:  # noqa: BLE001 - cleanup should report and continue.
            errors.append(
                StorageCleanupError(
                    job_id=candidate.job_id,
                    error=str(exc) or exc.__class__.__name__,
                )
            )
            continue

        deleted_jobs += 1
        freed_bytes += size

    failed_jobs = len(errors)
    pruned_favorites = 0
    if prunable:
        try:
            pruned_favorites = prune_orphaned_favorites(favorites_db_path, _live_job_ids(db_path))
        except Exception as exc:  # noqa: BLE001 - the deletions above are already committed.
            errors.append(_prune_error(exc))

    return StorageCleanupResponse(
        dry_run=False,
        days=days,
        zero_play_days=ZERO_PLAY_GRACE_DAYS,
        zero_plays_only=zero_plays_only,
        candidate_jobs=len(pairs),
        candidate_bytes=sum(size for _, size in pairs),
        candidates=[],
        orphaned_favorites=pruned_favorites,
        deleted_jobs=deleted_jobs,
        freed_bytes=freed_bytes,
        pruned_favorites=pruned_favorites,
        failed_jobs=failed_jobs,
        errors=errors,
    )
