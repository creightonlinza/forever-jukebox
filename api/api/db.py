"""SQLite job store for analysis requests."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional


@dataclass
class Job:
    id: str
    status: str
    input_path: str
    output_path: str
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
    "id, status, input_path, output_path, error, "
    "track_title, track_artist, source_id, source_provider, source_url, progress, "
    "play_count, created_at, updated_at"
)

TRACKS_BASE_FILTER = """
        track_title IS NOT NULL
          AND track_title != ''
          AND play_count > 0
"""


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


def _drop_legacy_column(conn: sqlite3.Connection, column_name: str) -> None:
    try:
        conn.execute(f"ALTER TABLE jobs DROP COLUMN {column_name}")
        return
    except sqlite3.OperationalError:
        # Fallback for older SQLite versions without DROP COLUMN support.
        pass

    conn.execute("DROP TABLE IF EXISTS jobs__migrated")
    conn.execute(
        """
        CREATE TABLE jobs__migrated (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            input_path TEXT NOT NULL,
            output_path TEXT NOT NULL,
            error TEXT,
            track_title TEXT,
            track_artist TEXT,
            source_id TEXT,
            source_provider TEXT,
            source_url TEXT,
            progress INTEGER NOT NULL DEFAULT 0,
            play_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO jobs__migrated (
            id, status, input_path, output_path, error,
            track_title, track_artist, source_id, source_provider, source_url,
            progress, play_count, created_at, updated_at
        )
        SELECT
            id, status, input_path, output_path, error,
            track_title, track_artist, source_id, source_provider, source_url,
            COALESCE(progress, 0),
            COALESCE(play_count, 0),
            created_at,
            updated_at
        FROM jobs
        """
    )
    conn.execute("DROP TABLE jobs")
    conn.execute("ALTER TABLE jobs__migrated RENAME TO jobs")


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                input_path TEXT NOT NULL,
                output_path TEXT NOT NULL,
                error TEXT,
                track_title TEXT,
                track_artist TEXT,
                source_id TEXT,
                source_provider TEXT,
                source_url TEXT,
                progress INTEGER NOT NULL DEFAULT 0,
                play_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()
        }
        if "track_title" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN track_title TEXT")
        if "track_artist" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN track_artist TEXT")
        if "source_id" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN source_id TEXT")
        if "source_provider" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN source_provider TEXT")
        if "source_url" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN source_url TEXT")
        if "progress" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
        if "play_count" not in columns:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0"
            )
        if "youtube_id" in columns:
            conn.execute(
                """
                UPDATE jobs
                SET source_id = youtube_id
                WHERE (source_id IS NULL OR source_id = '')
                  AND youtube_id IS NOT NULL
                  AND youtube_id != ''
                """
            )
        if "is_user_supplied" in columns:
            conn.execute(
                """
                UPDATE jobs
                SET source_provider = CASE
                    WHEN source_id IS NOT NULL AND source_id LIKE 'soundcloud:%' THEN 'soundcloud'
                    WHEN source_id IS NOT NULL AND source_id LIKE 'bandcamp:%' THEN 'bandcamp'
                    WHEN source_id IS NOT NULL AND source_id != '' THEN 'youtube'
                    WHEN source_url LIKE '%soundcloud.com%' THEN 'soundcloud'
                    WHEN source_url LIKE '%bandcamp.com%' THEN 'bandcamp'
                    WHEN source_url LIKE '%youtube.com%' OR source_url LIKE '%youtu.be%' THEN 'youtube'
                    ELSE 'upload'
                END
                WHERE is_user_supplied = 1
                  AND (source_provider IS NULL OR source_provider = '' OR source_provider = 'user')
                """
            )
        conn.execute(
            """
            UPDATE jobs
            SET source_id = CASE
                WHEN source_provider = 'soundcloud' AND source_id LIKE 'soundcloud:%'
                    THEN SUBSTR(source_id, 12)
                WHEN source_provider = 'bandcamp' AND source_id LIKE 'bandcamp:%'
                    THEN SUBSTR(source_id, 10)
                WHEN source_provider = 'youtube' AND source_id LIKE 'youtube:%'
                    THEN SUBSTR(source_id, 9)
                ELSE source_id
            END
            WHERE source_id IS NOT NULL AND source_id != ''
            """
        )
        conn.execute(
            """
            UPDATE jobs
            SET source_provider = CASE
                WHEN source_id IS NOT NULL AND source_id LIKE 'soundcloud:%' THEN 'soundcloud'
                WHEN source_id IS NOT NULL AND source_id LIKE 'bandcamp:%' THEN 'bandcamp'
                WHEN source_id IS NOT NULL AND source_id != '' THEN 'youtube'
                WHEN source_url LIKE '%soundcloud.com%' THEN 'soundcloud'
                WHEN source_url LIKE '%bandcamp.com%' THEN 'bandcamp'
                WHEN source_url LIKE '%youtube.com%' OR source_url LIKE '%youtu.be%' THEN 'youtube'
                WHEN input_path IS NOT NULL AND input_path != '' THEN 'upload'
                ELSE source_provider
            END
            WHERE source_provider IS NULL OR source_provider = '' OR source_provider = 'user'
            """
        )
        columns_after_migration = {
            row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()
        }
        if "youtube_id" in columns_after_migration:
            _drop_legacy_column(conn, "youtube_id")
            columns_after_migration = {
                row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()
            }
        if "is_user_supplied" in columns_after_migration:
            _drop_legacy_column(conn, "is_user_supplied")
        conn.commit()


def create_job(
    db_path: Path,
    job_id: str,
    input_path: str,
    output_path: str,
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
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, status, input_path, output_path, error,
                track_title, track_artist, source_id, source_provider, source_url, progress, play_count,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                status,
                input_path,
                output_path,
                track_title,
                track_artist,
                source_id,
                source_provider,
                source_url,
                progress,
                play_count,
                now,
                now,
            ),
        )
        conn.commit()


def get_job(db_path: Path, job_id: str) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    return _job_from_row(row)


def set_job_status(db_path: Path, job_id: str, status: str, error: Optional[str] = None) -> None:
    now = _utc_now()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            (status, error, now, job_id),
        )
        conn.commit()


def recover_stalled_processing_jobs(db_path: Path) -> int:
    now = _utc_now()
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = 'queued', progress = 0, error = NULL, updated_at = ? "
            "WHERE status = 'processing'",
            (now,),
        )
        conn.commit()
    return int(cur.rowcount or 0)


def delete_job(db_path: Path, job_id: str) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        conn.commit()


def claim_next_job(db_path: Path) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        conn.isolation_level = None
        conn.execute("BEGIN IMMEDIATE")
        job = _job_from_row(
            conn.execute(
                f"SELECT {JOB_SELECT_COLUMNS} FROM jobs "
                "WHERE status = 'queued' ORDER BY created_at, id LIMIT 1"
            ).fetchone()
        )
        if not job:
            conn.execute("COMMIT")
            return None
        conn.execute(
            "UPDATE jobs SET status = 'processing', progress = ?, updated_at = ? WHERE id = ?",
            (0, _utc_now(), job.id),
        )
        conn.execute("COMMIT")
    return job


def count_queued_jobs_ahead(db_path: Path, job_id: str, created_at: str) -> int:
    with sqlite3.connect(db_path) as conn:
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
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs "
            "WHERE source_provider = ? AND source_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (source_provider, source_id),
        ).fetchone()
    return _job_from_row(row)


def get_job_by_track(db_path: Path, title: str, artist: str) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            f"SELECT {JOB_SELECT_COLUMNS} FROM jobs "
            "WHERE track_title = ? AND track_artist = ? ORDER BY created_at DESC LIMIT 1",
            (title, artist),
        ).fetchone()
    return _job_from_row(row)


def increment_job_plays(db_path: Path, job_id: str) -> Optional[int]:
    now = _utc_now()
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE jobs SET play_count = play_count + 1, updated_at = ? WHERE id = ?",
            (now, job_id),
        )
        if cur.rowcount == 0:
            conn.commit()
            return None
        row = conn.execute(
            "SELECT play_count FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        conn.commit()
    if not row:
        return None
    return row[0]


def set_job_play_count(db_path: Path, job_id: str, play_count: int) -> Optional[int]:
    now = _utc_now()
    clamped = max(0, int(play_count))
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE jobs SET play_count = ?, updated_at = ? WHERE id = ?",
            (clamped, now, job_id),
        )
        if cur.rowcount == 0:
            conn.commit()
            return None
        row = conn.execute(
            "SELECT play_count FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        conn.commit()
    if not row:
        return None
    return row[0]


def set_job_progress(db_path: Path, job_id: str, progress: int) -> None:
    clamped = max(0, min(100, int(progress)))
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?",
            (clamped, _utc_now(), job_id),
        )
        conn.commit()


def update_job_input_path(db_path: Path, job_id: str, input_path: str) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET input_path = ?, updated_at = ? WHERE id = ?",
            (input_path, _utc_now(), job_id),
        )
        conn.commit()


def update_job_track_metadata(
    db_path: Path, job_id: str, track_title: Optional[str], track_artist: Optional[str]
) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET track_title = ?, track_artist = ?, updated_at = ? WHERE id = ?",
            (track_title, track_artist, _utc_now(), job_id),
        )
        conn.commit()


def get_top_tracks(
    db_path: Path,
    limit: int = 10,
    touched_within_days: int | None = None,
    exclude_top_n: int | None = None,
) -> list[dict]:
    cutoff: str | None = None
    if touched_within_days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=touched_within_days)).isoformat()

    query = """
            SELECT id, track_title, track_artist, source_id, source_provider, play_count
            FROM jobs
            WHERE
    """
    query += TRACKS_BASE_FILTER

    if exclude_top_n is not None:
        query += (
            """
              AND id NOT IN (
                SELECT id
                FROM jobs
                WHERE
            """
            + TRACKS_BASE_FILTER
            + """
                ORDER BY play_count DESC, updated_at DESC
                LIMIT ?
              )
            """
        )
    params: list[object] = []
    if exclude_top_n is not None:
        params.append(exclude_top_n)
    if cutoff is not None:
        query += "\n              AND updated_at >= ?"
        params.append(cutoff)
    if cutoff is not None:
        # Recency-decayed ranking for time-windowed lists (e.g. trending):
        # higher play_count helps, but stale tracks lose weight each hour.
        query += (
            """
            ORDER BY
              (play_count * 1.0) / (
                1.0 + MAX(0.0, (julianday('now') - julianday(updated_at)) * 24.0)
              ) DESC,
              play_count DESC,
              updated_at DESC
            LIMIT ?
            """
        )
    else:
        query += "\n            ORDER BY play_count DESC, updated_at DESC\n            LIMIT ?"
    params.append(limit)

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(query, tuple(params)).fetchall()
    return [_top_track_from_row(row) for row in rows]


def get_recent_tracks(db_path: Path, limit: int = 10) -> list[dict]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, track_title, track_artist, source_id, source_provider, play_count
            FROM jobs
            WHERE
            """
            + TRACKS_BASE_FILTER
            + """
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [_top_track_from_row(row) for row in rows]
