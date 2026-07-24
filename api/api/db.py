"""SQLite runtime store for analysis jobs and sources."""

from __future__ import annotations

import hashlib
import logging
import random
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from .db_migrations import run_migrations

logger = logging.getLogger("foreverjukebox.api.db")

SQLITE_CONNECT_TIMEOUT_S = 30.0
SQLITE_BUSY_TIMEOUT_MS = 30_000
CLAIM_BUSY_TIMEOUT_MS = 250
CLAIM_RETRY_DELAYS_S = (0.05, 0.1, 0.2, 0.4)
SELECT_JOB_SOURCE_REF_SQL = "SELECT source_ref FROM jobs WHERE id = ?"


@dataclass
class Job:
    id: str
    status: str
    error: Optional[str]
    track_title: Optional[str]
    track_artist: Optional[str]
    source_id: Optional[str]
    source_provider: Optional[str]
    source_url: Optional[str]
    progress: int
    play_count: int
    created_at: str
    updated_at: str


JOB_SELECT_COLUMNS = (
    "j.id, j.status, j.error, "
    "s.track_title, s.track_artist, "
    "CASE WHEN s.provider = 'youtube' THEN s.source_id ELSE NULL END AS source_id, "
    "s.provider AS source_provider, s.source_url, "
    "j.progress, s.play_count, j.created_at, j.updated_at"
)

TRACKS_BASE_FILTER = """
        s.track_title IS NOT NULL
          AND s.track_title != ''
          AND s.play_count > 0
"""

PROVIDERS = {"youtube", "soundcloud", "bandcamp", "upload"}
SOURCE_HOST_PROVIDER = (
    ("youtu.be", "youtube"),
    ("youtube.com", "youtube"),
    ("soundcloud.com", "soundcloud"),
    ("bandcamp.com", "bandcamp"),
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_from_row(row: tuple | None) -> Optional[Job]:
    if not row:
        return None
    return Job(*row)


def _top_track_from_row(row: tuple) -> dict[str, object]:
    return {
        "id": row[0],
        "title": row[1],
        "artist": row[2],
        "source_id": row[3],
        "source_provider": row[4],
        "play_count": row[5],
    }


def _clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _safe_int(value: object, default: int = 0) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return parsed


def _clamp_progress(value: object) -> int:
    return max(0, min(100, _safe_int(value, 0)))


def _connect(
    db_path: Path,
    *,
    timeout_s: float = SQLITE_CONNECT_TIMEOUT_S,
    busy_timeout_ms: int = SQLITE_BUSY_TIMEOUT_MS,
) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=timeout_s)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
    return conn


def _is_sqlite_lock_error(exc: BaseException) -> bool:
    if not isinstance(exc, sqlite3.OperationalError):
        return False
    message = str(exc).lower()
    return "database is locked" in message or "database table is locked" in message


def _provider_for_url(source_url: str | None) -> str | None:
    if not source_url:
        return None
    host = (urlsplit(source_url).hostname or "").lower()
    if not host:
        return None
    for suffix, provider in SOURCE_HOST_PROVIDER:
        if host == suffix or host.endswith(f".{suffix}"):
            return provider
    return None


def _canonical_http_url(raw: str | None) -> str | None:
    if not raw:
        return None
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _youtube_url(source_id: str) -> str:
    return f"https://www.youtube.com/watch?v={source_id}"


def _normalize_provider(
    source_provider: str | None,
    source_id: str | None,
    source_url: str | None,
) -> str:
    if source_provider:
        provider = source_provider.strip().lower()
        if provider in PROVIDERS:
            return provider
    url_provider = _provider_for_url(source_url)
    if url_provider:
        return url_provider
    if source_id:
        return "youtube"
    return "upload"


def _normalize_job_source(
    *,
    source_provider: str | None,
    source_id: str | None,
    source_url: str | None,
) -> tuple[str, str | None, str | None]:
    normalized_url = _canonical_http_url(_clean_text(source_url))
    provider = _normalize_provider(
        _clean_text(source_provider),
        _clean_text(source_id),
        normalized_url,
    )
    normalized_source_id = _clean_text(source_id) if provider == "youtube" else None
    if provider == "youtube" and not normalized_source_id and normalized_url:
        parsed = urlsplit(normalized_url)
        host = (parsed.hostname or "").lower()
        if host.endswith("youtu.be"):
            path = parsed.path.strip("/")
            normalized_source_id = path or None
        elif host.endswith("youtube.com"):
            query = parsed.query
            for pair in query.split("&"):
                if pair.startswith("v=") and pair[2:].strip():
                    normalized_source_id = pair[2:].strip()
                    break
    if provider == "youtube" and not normalized_url and normalized_source_id:
        normalized_url = _youtube_url(normalized_source_id)
    return provider, normalized_source_id, normalized_url


def _source_ref_for(
    provider: str,
    source_id: str | None,
    source_url: str | None,
    fallback: str,
) -> str:
    if provider == "youtube" and source_id:
        return f"yt_{source_id}"
    if source_url:
        digest = hashlib.sha1(source_url.encode("utf-8")).hexdigest()
        return f"url_{digest[:24]}"
    digest = hashlib.sha1(fallback.encode("utf-8")).hexdigest()
    prefix = provider if provider in {"soundcloud", "bandcamp", "upload"} else "upload"
    return f"{prefix}_{digest[:24]}"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
        except sqlite3.OperationalError as exc:
            logger.warning("SQLite WAL setup failed for %s; continuing with default journal mode: %s", db_path, exc)
        run_migrations(conn)
        conn.commit()


def _lookup_source_for_job(
    conn: sqlite3.Connection,
    *,
    provider: str,
    source_id: str | None,
    source_url: str | None,
) -> tuple[str, str | None, str | None, str | None] | None:
    if provider == "youtube" and source_id:
        return conn.execute(
            "SELECT id, source_url, track_title, track_artist FROM sources WHERE provider = 'youtube' AND source_id = ?",
            (source_id,),
        ).fetchone()
    if source_url:
        return conn.execute(
            "SELECT id, source_url, track_title, track_artist FROM sources WHERE source_url = ?",
            (source_url,),
        ).fetchone()
    return None


def _upsert_source_for_job(
    conn: sqlite3.Connection,
    *,
    provider: str,
    source_id: str | None,
    source_url: str | None,
    track_title: str | None,
    track_artist: str | None,
    source_fallback: str,
) -> str:
    now = _utc_now()

    def update_existing(existing: tuple[str, str | None, str | None, str | None]) -> str:
        source_ref = str(existing[0])
        existing_url = _clean_text(existing[1])
        existing_title = _clean_text(existing[2])
        existing_artist = _clean_text(existing[3])
        next_url = existing_url or source_url
        next_title = existing_title or track_title
        next_artist = existing_artist if existing_artist is not None else (track_artist or "")
        conn.execute(
            """
            UPDATE sources
            SET source_url = ?, track_title = ?, track_artist = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_url, next_title, next_artist, now, source_ref),
        )
        return source_ref

    existing = _lookup_source_for_job(
        conn,
        provider=provider,
        source_id=source_id,
        source_url=source_url,
    )
    if existing:
        return update_existing(existing)

    base_ref = _source_ref_for(provider, source_id, source_url, source_fallback)
    source_ref = base_ref
    suffix = 2
    while conn.execute("SELECT 1 FROM sources WHERE id = ?", (source_ref,)).fetchone():
        source_ref = f"{base_ref}_{suffix}"
        suffix += 1

    try:
        conn.execute(
            """
            INSERT INTO sources (
                id, provider, source_id, source_url,
                track_title, track_artist, play_count,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                source_ref,
                provider,
                source_id,
                source_url,
                track_title,
                track_artist if track_artist is not None else "",
                now,
                now,
            ),
        )
    except sqlite3.IntegrityError:
        existing = _lookup_source_for_job(
            conn,
            provider=provider,
            source_id=source_id,
            source_url=source_url,
        )
        if not existing:
            raise
        return update_existing(existing)
    return source_ref


def create_job(
    db_path: Path,
    job_id: str,
    status: str = "queued",
    track_title: Optional[str] = None,
    track_artist: Optional[str] = None,
    source_id: Optional[str] = None,
    source_provider: Optional[str] = None,
    source_url: Optional[str] = None,
    progress: int = 0,
    play_count: int = 0,
) -> None:
    now = _utc_now()
    provider, normalized_source_id, normalized_source_url = _normalize_job_source(
        source_provider=source_provider,
        source_id=source_id,
        source_url=source_url,
    )
    with _connect(db_path) as conn:
        source_ref = _upsert_source_for_job(
            conn,
            provider=provider,
            source_id=normalized_source_id,
            source_url=normalized_source_url,
            track_title=track_title,
            track_artist=track_artist,
            source_fallback=job_id,
        )
        conn.execute(
            """
            INSERT INTO jobs (
                id, source_ref, status,
                error, progress, created_at, updated_at
            )
            VALUES (?, ?, ?, NULL, ?, ?, ?)
            """,
            (
                job_id,
                source_ref,
                status,
                _clamp_progress(progress),
                now,
                now,
            ),
        )
        if play_count > 0:
            conn.execute(
                """
                UPDATE sources
                SET play_count = play_count + ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (max(0, int(play_count)), now, source_ref),
            )
        conn.commit()


def get_job(db_path: Path, job_id: str) -> Optional[Job]:
    with _connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs j JOIN sources s ON s.id = j.source_ref WHERE j.id = ?",
            (job_id,),
        ).fetchone()
    return _job_from_row(row)


def set_job_status(db_path: Path, job_id: str, status: str, error: Optional[str] = None) -> None:
    now = _utc_now()
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            (status, error, now, job_id),
        )
        conn.commit()


def restart_failed_job(db_path: Path, job_id: str, expected_updated_at: str) -> bool:
    now = _utc_now()
    with _connect(db_path) as conn:
        cur = conn.execute(
            """
            UPDATE jobs
            SET status = 'downloading',
                error = NULL,
                progress = 0,
                created_at = ?,
                updated_at = ?
            WHERE id = ?
              AND status = 'failed'
              AND updated_at = ?
            """,
            (now, now, job_id, expected_updated_at),
        )
        conn.commit()
    return int(cur.rowcount or 0) == 1


def recover_stalled_processing_jobs(db_path: Path) -> int:
    now = _utc_now()
    with _connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = 'queued', progress = 0, error = NULL, updated_at = ? "
            "WHERE status = 'processing' AND error IS NULL",
            (now,),
        )
        conn.commit()
    return int(cur.rowcount or 0)


def delete_job(db_path: Path, job_id: str) -> None:
    with _connect(db_path) as conn:
        row = conn.execute(SELECT_JOB_SOURCE_REF_SQL, (job_id,)).fetchone()
        source_ref = row[0] if row else None
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        if source_ref:
            remaining = conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE source_ref = ?",
                (source_ref,),
            ).fetchone()
            remaining_count = int(remaining[0]) if remaining else 0
            if remaining_count <= 0:
                conn.execute("DELETE FROM sources WHERE id = ?", (source_ref,))
        conn.commit()


def _claim_next_job_once(db_path: Path) -> Optional[Job]:
    with _connect(
        db_path,
        timeout_s=CLAIM_BUSY_TIMEOUT_MS / 1000,
        busy_timeout_ms=CLAIM_BUSY_TIMEOUT_MS,
    ) as conn:
        conn.isolation_level = None
        transaction_started = False
        try:
            conn.execute("BEGIN IMMEDIATE")
            transaction_started = True
            row = conn.execute(
                "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1"
            ).fetchone()
            if not row:
                conn.execute("COMMIT")
                transaction_started = False
                return None
            job_id = str(row[0])
            now = _utc_now()
            conn.execute(
                "UPDATE jobs SET status = 'processing', progress = 0, updated_at = ? WHERE id = ?",
                (now, job_id),
            )
            job_row = conn.execute(
                f"SELECT {JOB_SELECT_COLUMNS} FROM jobs j JOIN sources s ON s.id = j.source_ref WHERE j.id = ?",
                (job_id,),
            ).fetchone()
            conn.execute("COMMIT")
            transaction_started = False
        except Exception:
            if transaction_started:
                try:
                    conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
            raise
    return _job_from_row(job_row)


def claim_next_job(db_path: Path) -> Optional[Job]:
    retry_delays = (*CLAIM_RETRY_DELAYS_S, None)
    for delay in retry_delays:
        try:
            return _claim_next_job_once(db_path)
        except sqlite3.OperationalError as exc:
            if not _is_sqlite_lock_error(exc):
                raise
            if delay is None:
                logger.warning("Could not claim a queued job because SQLite remained locked: %s", exc)
                return None
            time.sleep(delay + random.uniform(0.0, delay))
    return None


def count_queued_jobs_ahead(db_path: Path, job_id: str, created_at: str) -> int:
    with _connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT COUNT(*)
            FROM jobs
            WHERE status = 'queued'
              AND (
                created_at < ?
                OR (created_at = ? AND id < ?)
              )
            """,
            (created_at, created_at, job_id),
        ).fetchone()
    if not row:
        return 0
    return int(row[0])


def get_job_by_source(db_path: Path, source_provider: str, source_id: str) -> Optional[Job]:
    with _connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs j "
            "JOIN sources s ON s.id = j.source_ref "
            "WHERE s.provider = ? AND s.source_id = ? "
            "ORDER BY j.created_at DESC LIMIT 1",
            (source_provider, source_id),
        ).fetchone()
    return _job_from_row(row)


def get_job_by_source_url(db_path: Path, source_url: str) -> Optional[Job]:
    with _connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs j "
            "JOIN sources s ON s.id = j.source_ref "
            "WHERE s.source_url = ? "
            "ORDER BY j.created_at DESC LIMIT 1",
            (source_url,),
        ).fetchone()
    return _job_from_row(row)


def get_job_by_track(db_path: Path, title: str, artist: str) -> Optional[Job]:
    with _connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs j "
            "JOIN sources s ON s.id = j.source_ref "
            "WHERE s.track_title = ? AND s.track_artist = ? "
            "ORDER BY j.created_at DESC LIMIT 1",
            (title, artist),
        ).fetchone()
    return _job_from_row(row)


def increment_job_plays(db_path: Path, job_id: str) -> Optional[int]:
    now = _utc_now()
    with _connect(db_path) as conn:
        row = conn.execute(SELECT_JOB_SOURCE_REF_SQL, (job_id,)).fetchone()
        if not row:
            return None
        source_ref = row[0]
        conn.execute(
            """
            UPDATE sources
            SET play_count = play_count + 1,
                updated_at = ?
            WHERE id = ?
            """,
            (now, source_ref),
        )
        count_row = conn.execute(
            "SELECT play_count FROM sources WHERE id = ?",
            (source_ref,),
        ).fetchone()
        conn.commit()
    if not count_row:
        return None
    return int(count_row[0])


def set_job_play_count(db_path: Path, job_id: str, play_count: int) -> Optional[int]:
    clamped = max(0, int(play_count))
    with _connect(db_path) as conn:
        row = conn.execute(SELECT_JOB_SOURCE_REF_SQL, (job_id,)).fetchone()
        if not row:
            return None
        source_ref = row[0]
        # Admin override of the counter is not a listen, so leave updated_at
        # untouched: it tracks last play for storage-cleanup eligibility.
        conn.execute(
            """
            UPDATE sources
            SET play_count = ?
            WHERE id = ?
            """,
            (clamped, source_ref),
        )
        count_row = conn.execute(
            "SELECT play_count FROM sources WHERE id = ?",
            (source_ref,),
        ).fetchone()
        conn.commit()
    if not count_row:
        return None
    return int(count_row[0])


def set_job_progress(db_path: Path, job_id: str, progress: int) -> None:
    clamped = _clamp_progress(progress)
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?",
            (clamped, _utc_now(), job_id),
        )
        conn.commit()


def update_job_track_metadata(
    db_path: Path, job_id: str, track_title: Optional[str], track_artist: Optional[str]
) -> None:
    with _connect(db_path) as conn:
        row = conn.execute(SELECT_JOB_SOURCE_REF_SQL, (job_id,)).fetchone()
        if not row:
            return
        source_ref = row[0]
        conn.execute(
            "UPDATE sources SET track_title = ?, track_artist = ?, updated_at = ? WHERE id = ?",
            (track_title, track_artist, _utc_now(), source_ref),
        )
        conn.commit()


def _exclude_top_source_refs(conn: sqlite3.Connection, exclude_top_n: int) -> list[str]:
    rows = conn.execute(
        """
        SELECT id
        FROM sources s
        WHERE
        """
        + TRACKS_BASE_FILTER
        + """
        ORDER BY s.play_count DESC, COALESCE(s.updated_at, s.created_at) DESC
        LIMIT ?
        """,
        (exclude_top_n,),
    ).fetchall()
    return [str(row[0]) for row in rows]


def get_top_tracks(
    db_path: Path,
    limit: int = 10,
    touched_within_days: int | None = None,
    exclude_top_n: int | None = None,
    min_play_count: int | None = None,
) -> list[dict]:
    cutoff: str | None = None
    if touched_within_days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=touched_within_days)).isoformat()

    with _connect(db_path) as conn:
        excluded_refs: list[str] = []
        if exclude_top_n is not None and exclude_top_n > 0:
            excluded_refs = _exclude_top_source_refs(conn, exclude_top_n)

        where_parts = [TRACKS_BASE_FILTER.strip()]
        params: list[object] = []

        activity_expr = "COALESCE(s.updated_at, s.created_at)"

        if cutoff is not None:
            where_parts.append(f"{activity_expr} >= ?")
            params.append(cutoff)
        if min_play_count is not None:
            where_parts.append("s.play_count >= ?")
            params.append(max(1, int(min_play_count)))

        if excluded_refs:
            placeholders = ",".join("?" for _ in excluded_refs)
            where_parts.append(f"s.id NOT IN ({placeholders})")
            params.extend(excluded_refs)

        query = (
            """
            SELECT
              (
                SELECT j.id
                FROM jobs j
                WHERE j.source_ref = s.id
                ORDER BY j.updated_at DESC, j.id DESC
                LIMIT 1
              ) AS id,
              s.track_title,
              s.track_artist,
              CASE WHEN s.provider = 'youtube' THEN s.source_id ELSE NULL END AS source_id,
              s.provider AS source_provider,
              s.play_count
            FROM sources s
            WHERE
            """
            + "\n              AND ".join(where_parts)
        )

        if cutoff is not None:
            query += (
                """
                ORDER BY
                  (s.play_count * 1.0) / (
                    1.0 + MAX(0.0, (julianday('now') - julianday("""
                + activity_expr
                + """)) * 24.0)
                  ) DESC,
                  s.play_count DESC,
                  """
                + activity_expr
                + """ DESC
                LIMIT ?
                """
            )
        else:
            query += (
                """
                ORDER BY s.play_count DESC, """
                + activity_expr
                + """ DESC
                LIMIT ?
                """
            )
        params.append(limit)

        rows = conn.execute(query, tuple(params)).fetchall()
    return [_top_track_from_row(row) for row in rows]


def get_recent_tracks(db_path: Path, limit: int = 10) -> list[dict]:
    activity_expr = "COALESCE(s.updated_at, s.created_at)"
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
              (
                SELECT j.id
                FROM jobs j
                WHERE j.source_ref = s.id
                ORDER BY j.updated_at DESC, j.id DESC
                LIMIT 1
              ) AS id,
              s.track_title,
              s.track_artist,
              CASE WHEN s.provider = 'youtube' THEN s.source_id ELSE NULL END AS source_id,
              s.provider AS source_provider,
              s.play_count
            FROM sources s
            WHERE
            """
            + TRACKS_BASE_FILTER
            + """
            ORDER BY """
            + activity_expr
            + """ DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [_top_track_from_row(row) for row in rows]
