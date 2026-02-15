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
    youtube_id: Optional[str]
    progress: int
    play_count: int
    is_user_supplied: int
    created_at: str
    updated_at: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
                youtube_id TEXT,
                progress INTEGER NOT NULL DEFAULT 0,
                play_count INTEGER NOT NULL DEFAULT 0,
                is_user_supplied INTEGER NOT NULL DEFAULT 0,
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
        if "youtube_id" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN youtube_id TEXT")
        if "progress" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
        if "play_count" not in columns:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0"
            )
        if "is_user_supplied" not in columns:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN is_user_supplied INTEGER NOT NULL DEFAULT 0"
            )
        conn.commit()


def create_job(
    db_path: Path,
    job_id: str,
    input_path: str,
    output_path: str,
    status: str = "queued",
    track_title: Optional[str] = None,
    track_artist: Optional[str] = None,
    youtube_id: Optional[str] = None,
    progress: int = 0,
    play_count: int = 0,
    is_user_supplied: int = 0,
) -> None:
    now = _utc_now()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, status, input_path, output_path, error,
                track_title, track_artist, youtube_id, progress, play_count, is_user_supplied, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                status,
                input_path,
                output_path,
                track_title,
                track_artist,
                youtube_id,
                progress,
                play_count,
                is_user_supplied,
                now,
                now,
            ),
        )
        conn.commit()


def get_job(db_path: Path, job_id: str) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, status, input_path, output_path, error, "
            "track_title, track_artist, youtube_id, progress, play_count, is_user_supplied, created_at, updated_at "
            "FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not row:
        return None
    return Job(*row)


def set_job_status(db_path: Path, job_id: str, status: str, error: Optional[str] = None) -> None:
    now = _utc_now()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            (status, error, now, job_id),
        )
        conn.commit()


def delete_job(db_path: Path, job_id: str) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        conn.commit()


def claim_next_job(db_path: Path) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        conn.isolation_level = None
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT id, status, input_path, output_path, error, "
            "track_title, track_artist, youtube_id, progress, play_count, is_user_supplied, created_at, updated_at "
            "FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1"
        ).fetchone()
        if not row:
            conn.execute("COMMIT")
            return None
        job = Job(*row)
        conn.execute(
            "UPDATE jobs SET status = 'processing', progress = ?, updated_at = ? WHERE id = ?",
            (0, _utc_now(), job.id),
        )
        conn.execute("COMMIT")
    return job

def get_job_by_youtube_id(db_path: Path, youtube_id: str) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, status, input_path, output_path, error, "
            "track_title, track_artist, youtube_id, progress, play_count, is_user_supplied, created_at, updated_at "
            "FROM jobs WHERE youtube_id = ? ORDER BY created_at DESC LIMIT 1",
            (youtube_id,),
        ).fetchone()
    if not row:
        return None
    return Job(*row)


def get_job_by_track(db_path: Path, title: str, artist: str) -> Optional[Job]:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, status, input_path, output_path, error, "
            "track_title, track_artist, youtube_id, progress, play_count, is_user_supplied, created_at, updated_at "
            "FROM jobs WHERE track_title = ? AND track_artist = ? ORDER BY created_at DESC LIMIT 1",
            (title, artist),
        ).fetchone()
    if not row:
        return None
    return Job(*row)


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

    base_filter = """
            track_title IS NOT NULL
              AND track_title != ''
              AND (
                (COALESCE(is_user_supplied, 0) = 0 AND track_artist IS NOT NULL AND track_artist != '')
                OR (COALESCE(is_user_supplied, 0) = 1 AND youtube_id IS NOT NULL AND youtube_id != '')
              )
              AND play_count > 0
    """

    query = """
            SELECT id, track_title, track_artist, youtube_id, play_count
            FROM jobs
            WHERE
    """
    query += base_filter

    if exclude_top_n is not None:
        query += (
            """
              AND id NOT IN (
                SELECT id
                FROM jobs
                WHERE
            """
            + base_filter
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
    query += "\n            ORDER BY play_count DESC, updated_at DESC\n            LIMIT ?"
    params.append(limit)

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(query, tuple(params)).fetchall()
    return [
        {
            "id": row[0],
            "title": row[1],
            "artist": row[2],
            "youtube_id": row[3],
            "play_count": row[4],
        }
        for row in rows
    ]


def get_recent_tracks(db_path: Path, limit: int = 10) -> list[dict]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, track_title, track_artist, youtube_id, play_count
            FROM jobs
            WHERE track_title IS NOT NULL
              AND track_title != ''
              AND (
                (COALESCE(is_user_supplied, 0) = 0 AND track_artist IS NOT NULL AND track_artist != '')
                OR (COALESCE(is_user_supplied, 0) = 1 AND youtube_id IS NOT NULL AND youtube_id != '')
              )
              AND play_count > 0
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "id": row[0],
            "title": row[1],
            "artist": row[2],
            "youtube_id": row[3],
            "play_count": row[4],
        }
        for row in rows
    ]
