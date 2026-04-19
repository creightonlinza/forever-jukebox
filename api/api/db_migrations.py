"""Database schema migrations for jobs/sources storage."""

from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

PROVIDERS = {"youtube", "soundcloud", "bandcamp", "upload"}
SOURCE_HOST_PROVIDER = (
    ("youtu.be", "youtube"),
    ("youtube.com", "youtube"),
    ("soundcloud.com", "soundcloud"),
    ("bandcamp.com", "bandcamp"),
)

MIGRATION_ID_0001 = "0001_sources_jobs_unification"


@dataclass
class _MigratedSource:
    key: str
    provider: str
    source_id: str | None
    source_url: str | None
    track_title: str | None
    track_artist: str | None
    play_count: int
    created_at: str
    updated_at: str


@dataclass
class _MigratedJob:
    id: str
    source_key: str
    status: str
    input_path: str
    output_path: str
    error: str | None
    progress: int
    created_at: str
    updated_at: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _columns_for(conn: sqlite3.Connection, table_name: str) -> set[str]:
    if not _table_exists(conn, table_name):
        return set()
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}


def _row_value(row: sqlite3.Row, key: str) -> object | None:
    if key not in row.keys():
        return None
    return row[key]


def _clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _clean_track_artist(value: object) -> str:
    cleaned = _clean_text(value)
    return cleaned if cleaned is not None else ""


def _safe_int(value: object, default: int = 0) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return parsed


def _clamp_progress(value: object) -> int:
    return max(0, min(100, _safe_int(value, 0)))


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


def _source_identity_key(
    provider: str,
    source_id: str | None,
    source_url: str | None,
    fallback: str,
) -> str:
    if provider == "youtube" and source_id:
        return f"youtube::{source_id}"
    if source_url:
        return f"url::{source_url}"
    return f"upload::{fallback}"


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


def _split_prefixed_source_id(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    cleaned = value.strip()
    if not cleaned or ":" not in cleaned:
        return None, cleaned or None
    prefix, rest = cleaned.split(":", 1)
    provider = prefix.strip().lower()
    source_part = rest.strip()
    if provider in PROVIDERS and source_part:
        return provider, source_part
    return None, cleaned


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            source_id TEXT,
            source_url TEXT,
            track_title TEXT,
            track_artist TEXT,
            play_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            source_ref TEXT NOT NULL,
            status TEXT NOT NULL,
            input_path TEXT NOT NULL,
            output_path TEXT NOT NULL,
            error TEXT,
            progress INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(source_ref) REFERENCES sources(id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at, id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_source_ref_created ON jobs(source_ref, created_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sources_provider ON sources(provider)")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_provider_source_id ON sources(provider, source_id) "
        "WHERE source_id IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_source_url ON sources(source_url) "
        "WHERE source_url IS NOT NULL"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sources_play ON sources(play_count DESC, updated_at DESC)")


def _is_current_schema(conn: sqlite3.Connection) -> bool:
    jobs_cols = _columns_for(conn, "jobs")
    sources_cols = _columns_for(conn, "sources")
    required_jobs = {
        "id",
        "source_ref",
        "status",
        "input_path",
        "output_path",
        "error",
        "progress",
        "created_at",
        "updated_at",
    }
    required_sources = {
        "id",
        "provider",
        "source_id",
        "source_url",
        "track_title",
        "track_artist",
        "play_count",
        "created_at",
        "updated_at",
    }
    return (
        required_jobs.issubset(jobs_cols)
        and required_sources.issubset(sources_cols)
    )


def _merge_source_record(target: _MigratedSource, incoming: _MigratedSource) -> None:
    if not target.source_url and incoming.source_url:
        target.source_url = incoming.source_url
    if not target.source_id and incoming.source_id:
        target.source_id = incoming.source_id
    if not target.track_title and incoming.track_title:
        target.track_title = incoming.track_title
    if (not target.track_artist) and incoming.track_artist:
        target.track_artist = incoming.track_artist
    target.play_count = max(0, target.play_count) + max(0, incoming.play_count)
    if incoming.created_at < target.created_at:
        target.created_at = incoming.created_at
    if incoming.updated_at > target.updated_at:
        target.updated_at = incoming.updated_at


def _infer_provider_from_legacy_job(row: sqlite3.Row, columns: set[str]) -> str:
    source_provider = _clean_text(_row_value(row, "source_provider"))
    source_id = _clean_text(_row_value(row, "source_id"))
    source_url = _canonical_http_url(_clean_text(_row_value(row, "source_url")))
    youtube_id = _clean_text(_row_value(row, "youtube_id"))
    input_path = _clean_text(_row_value(row, "input_path"))
    if source_provider and source_provider.lower() in PROVIDERS:
        return source_provider.lower()
    for raw_candidate in (source_id, youtube_id):
        prefixed_provider, _ = _split_prefixed_source_id(raw_candidate)
        if prefixed_provider:
            return prefixed_provider
    if source_url:
        guessed = _provider_for_url(source_url)
        if guessed:
            return guessed
    if source_id or youtube_id:
        return "youtube"
    if "is_user_supplied" in columns:
        is_user_supplied = _safe_int(_row_value(row, "is_user_supplied"), 0)
        if is_user_supplied > 0:
            return "upload"
    if input_path:
        return "upload"
    return "upload"


def _legacy_job_to_source(
    row: sqlite3.Row,
    columns: set[str],
) -> tuple[_MigratedSource, _MigratedJob]:
    now = _utc_now()
    job_id = _clean_text(_row_value(row, "id")) or hashlib.sha1(now.encode("utf-8")).hexdigest()[:32]

    provider = _infer_provider_from_legacy_job(row, columns)
    raw_source_id = _clean_text(_row_value(row, "source_id"))
    raw_youtube_id = _clean_text(_row_value(row, "youtube_id"))
    raw_candidate_id = raw_source_id or raw_youtube_id
    prefixed_provider, prefixed_source_id = _split_prefixed_source_id(raw_candidate_id)
    if provider == "youtube" and prefixed_provider and prefixed_provider != "youtube":
        provider = prefixed_provider
    source_id = None
    if provider == "youtube":
        if prefixed_provider == "youtube" and prefixed_source_id:
            source_id = prefixed_source_id
        else:
            source_id = raw_candidate_id

    source_url = _canonical_http_url(_clean_text(_row_value(row, "source_url")))
    if provider == "youtube" and not source_url and source_id:
        source_url = _youtube_url(source_id)

    created_at = _clean_text(_row_value(row, "created_at")) or now
    updated_at = _clean_text(_row_value(row, "updated_at")) or created_at

    play_count = max(0, _safe_int(_row_value(row, "play_count"), 0))
    source_key = _source_identity_key(provider, source_id, source_url, job_id)
    source = _MigratedSource(
        key=source_key,
        provider=provider,
        source_id=source_id,
        source_url=source_url,
        track_title=_clean_text(_row_value(row, "track_title")),
        track_artist=_clean_track_artist(_row_value(row, "track_artist")),
        play_count=play_count,
        created_at=created_at,
        updated_at=updated_at,
    )

    job = _MigratedJob(
        id=job_id,
        source_key=source_key,
        status=_clean_text(_row_value(row, "status")) or "queued",
        input_path=_clean_text(_row_value(row, "input_path")) or "",
        output_path=_clean_text(_row_value(row, "output_path")) or "",
        error=_clean_text(_row_value(row, "error")),
        progress=_clamp_progress(_row_value(row, "progress")),
        created_at=created_at,
        updated_at=updated_at,
    )
    return source, job


def _collect_from_jobs_only(
    conn: sqlite3.Connection,
) -> tuple[dict[str, _MigratedSource], list[_MigratedJob]]:
    columns = _columns_for(conn, "jobs")
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM jobs").fetchall()
    conn.row_factory = None

    sources: dict[str, _MigratedSource] = {}
    jobs: list[_MigratedJob] = []
    for row in rows:
        source, job = _legacy_job_to_source(row, columns)
        existing = sources.get(source.key)
        if existing is None:
            sources[source.key] = source
        else:
            _merge_source_record(existing, source)
        jobs.append(job)
    return sources, jobs


def _collect_from_sources_and_jobs(
    conn: sqlite3.Connection,
) -> tuple[dict[str, _MigratedSource], list[_MigratedJob]]:
    job_columns = _columns_for(conn, "jobs")

    conn.row_factory = sqlite3.Row
    source_rows = conn.execute("SELECT * FROM sources").fetchall()
    job_rows = conn.execute("SELECT * FROM jobs").fetchall()
    conn.row_factory = None

    sources: dict[str, _MigratedSource] = {}
    source_ref_to_key: dict[str, str] = {}
    now = _utc_now()

    for row in source_rows:
        raw_ref = _clean_text(_row_value(row, "id"))
        if not raw_ref:
            continue
        provider_raw = _clean_text(_row_value(row, "provider"))
        provider = provider_raw.lower() if provider_raw and provider_raw.lower() in PROVIDERS else "upload"

        source_id_raw = _clean_text(_row_value(row, "source_id"))
        provider_source_id = _clean_text(_row_value(row, "provider_source_id"))
        source_id = source_id_raw if provider == "youtube" else None
        if provider == "youtube" and not source_id:
            source_id = provider_source_id

        source_url = _canonical_http_url(_clean_text(_row_value(row, "source_url")))
        if provider == "youtube" and not source_url and source_id:
            source_url = _youtube_url(source_id)

        created_at = _clean_text(_row_value(row, "created_at")) or now
        updated_at = _clean_text(_row_value(row, "updated_at")) or created_at
        play_count = max(0, _safe_int(_row_value(row, "play_count"), 0))

        source_key = _source_identity_key(provider, source_id, source_url, raw_ref)
        source = _MigratedSource(
            key=source_key,
            provider=provider,
            source_id=source_id,
            source_url=source_url,
            track_title=_clean_text(_row_value(row, "track_title")),
            track_artist=_clean_track_artist(_row_value(row, "track_artist")),
            play_count=play_count,
            created_at=created_at,
            updated_at=updated_at,
        )

        existing = sources.get(source_key)
        if existing is None:
            sources[source_key] = source
        else:
            _merge_source_record(existing, source)
        source_ref_to_key[raw_ref] = source_key

    jobs: list[_MigratedJob] = []
    for row in job_rows:
        job_id = _clean_text(_row_value(row, "id"))
        if not job_id:
            continue
        source_ref = _clean_text(_row_value(row, "source_ref"))
        source_key = source_ref_to_key.get(source_ref or "")
        if not source_key:
            source_key = _source_identity_key("upload", None, None, job_id)
            if source_key not in sources:
                created_at = _clean_text(_row_value(row, "created_at")) or now
                updated_at = _clean_text(_row_value(row, "updated_at")) or created_at
                sources[source_key] = _MigratedSource(
                    key=source_key,
                    provider="upload",
                    source_id=None,
                    source_url=None,
                    track_title=None,
                    track_artist="",
                    play_count=0,
                    created_at=created_at,
                    updated_at=updated_at,
                )

        created_at = _clean_text(_row_value(row, "created_at")) or now
        updated_at = _clean_text(_row_value(row, "updated_at")) or created_at

        jobs.append(
            _MigratedJob(
                id=job_id,
                source_key=source_key,
                status=_clean_text(_row_value(row, "status")) or "queued",
                input_path=_clean_text(_row_value(row, "input_path")) or "",
                output_path=_clean_text(_row_value(row, "output_path")) or "",
                error=_clean_text(_row_value(row, "error")),
                progress=_clamp_progress(_row_value(row, "progress")),
                created_at=created_at,
                updated_at=updated_at,
            )
        )

    if not jobs and "play_count" in job_columns:
        for source_key, source in sources.items():
            synthetic_job_id = hashlib.sha1(source_key.encode("utf-8")).hexdigest()[:32]
            jobs.append(
                _MigratedJob(
                    id=synthetic_job_id,
                    source_key=source_key,
                    status="failed",
                    input_path="",
                    output_path="",
                    error="Recovered from malformed legacy schema",
                    progress=0,
                    created_at=source.created_at,
                    updated_at=source.updated_at,
                )
            )
    return sources, jobs


def _apply_migrated_records(
    conn: sqlite3.Connection,
    sources_by_key: dict[str, _MigratedSource],
    jobs: list[_MigratedJob],
) -> None:
    conn.execute("DROP TABLE IF EXISTS jobs")
    conn.execute("DROP TABLE IF EXISTS sources")
    _create_schema(conn)

    source_key_to_ref: dict[str, str] = {}
    used_refs: set[str] = set()

    for source in sources_by_key.values():
        base_ref = _source_ref_for(source.provider, source.source_id, source.source_url, source.key)
        source_ref = base_ref
        suffix = 2
        while source_ref in used_refs:
            source_ref = f"{base_ref}_{suffix}"
            suffix += 1
        used_refs.add(source_ref)
        source_key_to_ref[source.key] = source_ref

        conn.execute(
            """
            INSERT INTO sources (
                id, provider, source_id, source_url,
                track_title, track_artist, play_count,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_ref,
                source.provider,
                source.source_id,
                source.source_url,
                source.track_title,
                source.track_artist if source.track_artist is not None else "",
                max(0, int(source.play_count)),
                source.created_at,
                source.updated_at,
            ),
        )

    for job in jobs:
        source_ref = source_key_to_ref.get(job.source_key)
        if not source_ref:
            source_ref = _source_ref_for("upload", None, None, job.id)
            if source_ref not in used_refs:
                used_refs.add(source_ref)
                now = _utc_now()
                conn.execute(
                    """
                    INSERT INTO sources (
                        id, provider, source_id, source_url,
                        track_title, track_artist, play_count,
                        created_at, updated_at
                    )
                    VALUES (?, 'upload', NULL, NULL, NULL, '', 0, ?, ?)
                    """,
                    (source_ref, now, now),
                )

        conn.execute(
            """
            INSERT INTO jobs (
                id, source_ref, status, input_path, output_path,
                error, progress, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job.id,
                source_ref,
                job.status,
                job.input_path,
                job.output_path,
                job.error,
                _clamp_progress(job.progress),
                job.created_at,
                job.updated_at,
            ),
        )


def _migrate_to_current_schema(conn: sqlite3.Connection) -> None:
    jobs_cols = _columns_for(conn, "jobs")
    if not jobs_cols:
        _create_schema(conn)
        return

    has_sources = _table_exists(conn, "sources")
    if has_sources and "source_ref" in jobs_cols:
        sources_by_key, jobs = _collect_from_sources_and_jobs(conn)
    else:
        sources_by_key, jobs = _collect_from_jobs_only(conn)

    _apply_migrated_records(conn, sources_by_key, jobs)


def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )


def _applied_migrations(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT id FROM schema_migrations").fetchall()
    return {str(row[0]) for row in rows}


def _mark_migration_applied(conn: sqlite3.Connection, migration_id: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, _utc_now()),
    )


def run_migrations(conn: sqlite3.Connection) -> None:
    """Apply schema migrations in order, recording applied versions."""

    _ensure_migrations_table(conn)
    applied = _applied_migrations(conn)

    needs_0001 = MIGRATION_ID_0001 not in applied
    schema_current = _is_current_schema(conn)
    if needs_0001 or not schema_current:
        if not _table_exists(conn, "jobs") and not _table_exists(conn, "sources"):
            _create_schema(conn)
        elif schema_current:
            _create_schema(conn)
        else:
            _migrate_to_current_schema(conn)
        if needs_0001:
            _mark_migration_applied(conn, MIGRATION_ID_0001)

    _create_schema(conn)
