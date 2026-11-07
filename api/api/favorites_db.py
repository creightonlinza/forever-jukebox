"""SQLite store for favorites sync payloads."""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
from contextlib import closing, suppress
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .paths import WORDLIST_PATH


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_favorites_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites_sync (
                code TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(favorites_sync)")}
        if "updated_at" not in columns:
            # Rows that predate the column have no edit history; created_at is the
            # only timestamp available for them.
            conn.execute("ALTER TABLE favorites_sync ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE favorites_sync SET updated_at = created_at WHERE updated_at = ''")
        conn.commit()


def save_favorites(db_path: Path, code: str, favorites: list[dict[str, Any]]) -> None:
    payload = json.dumps(favorites, ensure_ascii=True)
    now = _utc_now()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO favorites_sync (code, payload, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (code, payload, now, now),
        )
        conn.commit()


def update_favorites(db_path: Path, code: str, favorites: list[dict[str, Any]]) -> bool:
    payload = json.dumps(favorites, ensure_ascii=True)
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE favorites_sync SET payload = ?, updated_at = ? WHERE code = ?",
            (payload, _utc_now(), code),
        )
        conn.commit()
    return cur.rowcount > 0


def prune_orphaned_favorites(
    db_path: Path,
    live_job_ids: set[str],
    *,
    apply: bool = True,
) -> int:
    """Drop favorite entries whose job no longer exists; returns how many matched.

    Favorites key on job id, so a deleted job leaves an entry that can never
    resolve again. `live_job_ids` must come from a readable jobs table: every
    entry outside it is pruned, so an empty set empties every list.
    """
    if not db_path.exists():
        return 0
    orphaned = 0
    now = _utc_now()
    with closing(sqlite3.connect(db_path)) as conn:
        if apply:
            # Read and rewrite under one write lock: a sync landing mid-prune
            # would otherwise be overwritten with a stale list.
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
        try:
            rows = conn.execute("SELECT code, payload FROM favorites_sync").fetchall()
            for code, payload in rows:
                try:
                    items = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if not isinstance(items, list):
                    continue
                kept = [item for item in items if _favorite_is_live(item, live_job_ids)]
                if len(kept) == len(items):
                    continue
                orphaned += len(items) - len(kept)
                if apply:
                    conn.execute(
                        "UPDATE favorites_sync SET payload = ?, updated_at = ? WHERE code = ?",
                        (json.dumps(kept, ensure_ascii=True), now, code),
                    )
            if apply:
                conn.execute("COMMIT")
        except BaseException:
            if apply:
                with suppress(sqlite3.Error):
                    conn.execute("ROLLBACK")
            raise
    return orphaned


def _favorite_is_live(item: Any, live_job_ids: set[str]) -> bool:
    """Entries without a readable job id are left alone."""
    if not isinstance(item, dict):
        return True
    job_id = item.get("uniqueSongId")
    if not job_id:
        return True
    return job_id in live_job_ids


def load_favorites(db_path: Path, code: str) -> Optional[list[dict[str, Any]]]:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT payload FROM favorites_sync WHERE code = ?",
            (code,),
        ).fetchone()
    if not row:
        return None
    payload = row[0]
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    return data


def create_unique_code(db_path: Path, max_attempts: int = 3) -> str:
    vibe_words, object_words, music_words = _load_word_buckets()
    if not vibe_words or not object_words or not music_words:
        raise RuntimeError("Wordlist does not contain enough entries")
    for _ in range(max_attempts):
        code = "-".join(
            [
                secrets.choice(vibe_words),
                secrets.choice(object_words),
                secrets.choice(music_words),
            ]
        )
        if not _code_exists(db_path, code):
            return code
    raise RuntimeError("Unable to generate a unique sync code")


def _code_exists(db_path: Path, code: str) -> bool:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM favorites_sync WHERE code = ?",
            (code,),
        ).fetchone()
    return row is not None


@lru_cache(maxsize=1)
def _load_word_buckets() -> tuple[list[str], list[str], list[str]]:
    if not WORDLIST_PATH.exists():
        return ([], [], [])
    text = WORDLIST_PATH.read_text(encoding="utf-8")
    vibe = _extract_word_list(text, "SYNC_VIBE_WORDS")
    objects = _extract_word_list(text, "SYNC_OBJECT_WORDS")
    music = _extract_word_list(text, "SYNC_MUSIC_WORDS")
    return (vibe, objects, music)


def _extract_word_list(text: str, name: str) -> list[str]:
    pattern = rf"{name}\s*=\s*\[(.*?)\];"
    match = re.search(pattern, text, re.DOTALL)
    if not match:
        return []
    section = match.group(1)
    words = re.findall(r'"([^"]+)"', section)
    return [word.strip().lower() for word in words if word.strip()]
