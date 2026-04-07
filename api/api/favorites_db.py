"""SQLite store for favorites sync payloads."""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
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
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def save_favorites(db_path: Path, code: str, favorites: list[dict[str, Any]]) -> None:
    payload = json.dumps(favorites, ensure_ascii=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO favorites_sync (code, payload, created_at) VALUES (?, ?, ?)",
            (code, payload, _utc_now()),
        )
        conn.commit()


def update_favorites(db_path: Path, code: str, favorites: list[dict[str, Any]]) -> bool:
    payload = json.dumps(favorites, ensure_ascii=True)
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE favorites_sync SET payload = ? WHERE code = ?",
            (payload, code),
        )
        conn.commit()
    return cur.rowcount > 0


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
