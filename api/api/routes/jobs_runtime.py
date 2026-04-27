"""Runtime helpers for job lifecycle operations."""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from ..db import (
    delete_job,
    get_job,
    set_job_progress,
    set_job_status,
    update_job_input_path,
    update_job_track_metadata,
)
from ..env import env_positive_float
from ..paths import DB_PATH, STORAGE_ROOT
from ..utils import abs_storage_path, get_logger
from ..ytdlp_config import apply_ejs_config

ERROR_ENGINE = "ERROR: Analysis engine encountered an issue."
ERROR_NO_BEATS_DETECTED = (
    "ERROR: No beats or downbeats were detected in this audio. "
    "The track may be silent or lack a clear rhythm."
)
ERROR_YOUTUBE_UNAVAILABLE = "ERROR: This video is not available on YouTube."
ERROR_DOWNLOAD_UNAVAILABLE = "ERROR: Unable to download video data."
ERROR_YOUTUBE_AGE_RESTRICTED = "ERROR: YouTube fetch failed due to age restriction block."
ERROR_YOUTUBE_UNREACHABLE = "ERROR: Unable to reach YouTube"
ERROR_TRACK_TOO_LONG = "ERROR: This track exceeds the server length limit."
ERROR_GENERIC = "ERROR: Something went wrong. Please try again or report an issue on GitHub."
ERROR_CODE_ANALYSIS_MISSING = "analysis_missing"
ERROR_CODE_NO_BEATS_DETECTED = "no_beats_detected"
ANALYSIS_MISSING_MESSAGE = "Analysis missing"
NTFY_TOPIC_ENV = "NTFY_TOPIC_KEY"

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_UPLOAD_EXTS = {".m4a", ".webm", ".mp3", ".wav", ".flac", ".ogg", ".aac"}

logger = get_logger()
YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
SOURCE_HOST_PROVIDER = (
    ("youtu.be", "youtube"),
    ("youtube.com", "youtube"),
    ("soundcloud.com", "soundcloud"),
    ("bandcamp.com", "bandcamp"),
)


@dataclass(frozen=True)
class SourceInfo:
    provider: str
    source_id: str
    source_url: str
    duration_s: float | None


def source_url_from_youtube_id(youtube_id: str) -> str:
    return f"https://www.youtube.com/watch?v={youtube_id}"


def source_url_from_source_id(source_provider: str | None, source_id: str | None) -> str | None:
    if not source_provider or not source_id:
        return None
    if source_provider == "youtube":
        return source_url_from_youtube_id(source_id)
    return None


def fallback_source_url_for_source_id(source_id: str | None) -> str | None:
    if not source_id:
        return None
    if not YOUTUBE_ID_RE.fullmatch(source_id):
        return None
    return source_url_from_youtube_id(source_id)


def _provider_for_host(host: str | None) -> str | None:
    if not host:
        return None
    lowered = host.lower()
    for suffix, provider in SOURCE_HOST_PROVIDER:
        if lowered == suffix or lowered.endswith(f".{suffix}"):
            return provider
    return None


def normalize_user_source_url(raw: str) -> str | None:
    value = raw.strip()
    if not value:
        return None
    if YOUTUBE_ID_RE.fullmatch(value):
        return source_url_from_youtube_id(value)
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    provider = _provider_for_host(parsed.hostname)
    if not provider:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _coerce_duration(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    duration_s = float(value)
    if not math.isfinite(duration_s) or duration_s <= 0:
        return None
    return duration_s


def _canonical_source_url(info: dict, fallback: str) -> str:
    for key in ("webpage_url", "original_url"):
        candidate = info.get(key)
        if isinstance(candidate, str) and candidate.strip():
            parsed = urlsplit(candidate)
            if parsed.scheme.lower() in {"http", "https"}:
                return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    return fallback


def _provider_from_info(info: dict, source_url: str) -> str | None:
    extractor = str(info.get("extractor_key") or info.get("extractor") or "").lower()
    for provider in ("youtube", "soundcloud", "bandcamp"):
        if provider in extractor:
            return provider
    return _provider_for_host(urlsplit(source_url).hostname)


def _source_id_for_provider(provider: str, raw_id: str) -> str:
    return raw_id


def resolve_source_info(source_url: str) -> SourceInfo:
    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:
        raise RuntimeError("yt-dlp is not available") from exc

    ydl_opts = {
        "quiet": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
    }
    apply_ejs_config(ydl_opts)
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(source_url, download=False)
    if not isinstance(info, dict):
        raise ValueError("Unsupported URL")
    entries = info.get("entries")
    if isinstance(entries, list) and entries:
        raise ValueError("Playlists and albums are not supported")
    canonical_url = _canonical_source_url(info, source_url)
    provider = _provider_from_info(info, canonical_url)
    if provider is None:
        raise ValueError("Unsupported URL")
    raw_id = info.get("id")
    if not isinstance(raw_id, str) or not raw_id.strip():
        raise ValueError("Unable to resolve source id")
    source_id = _source_id_for_provider(provider, raw_id.strip())
    return SourceInfo(
        provider=provider,
        source_id=source_id,
        source_url=canonical_url,
        duration_s=_coerce_duration(info.get("duration")),
    )


def probe_source_duration_seconds(source_url: str) -> float | None:
    try:
        info = resolve_source_info(source_url)
    except Exception:
        return None
    return info.duration_s


def normalize_job_error(raw: str | None) -> str:
    if not raw:
        return ERROR_GENERIC
    lowered = raw.lower()
    if (
        "no beats or downbeats were detected" in lowered
        or "madmom-beats-lite extraction empty" in lowered
    ):
        return ERROR_NO_BEATS_DETECTED
    if "engine exited" in lowered:
        return ERROR_ENGINE
    if "video unavailable" in lowered or "this video is not available" in lowered:
        return ERROR_YOUTUBE_UNAVAILABLE
    if "http error 403" in lowered or "[download]" in lowered or "unable to download video data" in lowered:
        return ERROR_DOWNLOAD_UNAVAILABLE
    if (
        "sign in to confirm your age" in lowered
        or "inappropriate for some users" in lowered
        or "age-restricted" in lowered
        or "age restriction" in lowered
    ):
        return ERROR_YOUTUBE_AGE_RESTRICTED
    if "sign in to confirm" in lowered or "not a bot" in lowered:
        return ERROR_YOUTUBE_UNREACHABLE
    if "max_track_length" in lowered or "track exceeds max track length" in lowered:
        return ERROR_TRACK_TOO_LONG
    if "max track length for this server is" in lowered:
        return ERROR_TRACK_TOO_LONG
    return ERROR_GENERIC


def error_code_for(raw: str | None) -> str | None:
    if not raw:
        return None
    if raw == ANALYSIS_MISSING_MESSAGE:
        return ERROR_CODE_ANALYSIS_MISSING
    if normalize_job_error(raw) == ERROR_NO_BEATS_DETECTED:
        return ERROR_CODE_NO_BEATS_DETECTED
    return None


def failure_code_for(raw: str | None) -> str:
    normalized = normalize_job_error(raw)
    if normalized == ERROR_NO_BEATS_DETECTED:
        return ERROR_CODE_NO_BEATS_DETECTED
    if normalized == ERROR_ENGINE:
        return "engine_error"
    if normalized == ERROR_YOUTUBE_UNAVAILABLE:
        return "youtube_unavailable"
    if normalized == ERROR_DOWNLOAD_UNAVAILABLE:
        return "download_unavailable"
    if normalized == ERROR_YOUTUBE_AGE_RESTRICTED:
        return "youtube_age_restricted"
    if normalized == ERROR_YOUTUBE_UNREACHABLE:
        return "youtube_unreachable"
    if normalized == ERROR_TRACK_TOO_LONG:
        return "track_too_long"
    return "generic_error"


def sanitize_title(filename: str | None) -> str:
    if not filename:
        return "Untitled"
    name = Path(filename).name
    stem = Path(name).stem
    stem = stem.replace("_", " ").replace("-", " ")
    cleaned = "".join(ch for ch in stem if ch.isprintable())
    cleaned = " ".join(cleaned.split()).strip()
    if not cleaned:
        return "Untitled"
    return cleaned[:200]


def _sanitize_log_text(value: str | None, max_len: int = 200) -> str | None:
    if value is None:
        return None
    cleaned = "".join(ch for ch in value if ch.isprintable())
    cleaned = " ".join(cleaned.split()).strip()
    if not cleaned:
        return None
    return cleaned[:max_len]


def log_event(event: str, **fields: object) -> None:
    payload: dict[str, object] = {"event": event}
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str):
            sanitized = _sanitize_log_text(value)
            if sanitized is None:
                continue
            payload[key] = sanitized
            continue
        payload[key] = value
    logger.info("%s", json.dumps(payload, separators=(",", ":"), ensure_ascii=True))


def _format_minutes(value: float) -> str:
    rounded = round(value, 2)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:g}"


def _max_track_length_error_message(max_track_length_min: float) -> str:
    return (
        "Error: Sorry, the max track length for this server is "
        f"{_format_minutes(max_track_length_min)} minutes."
    )


def track_too_long_detail(max_track_length_min: float) -> dict[str, str]:
    return {
        "error_code": "track_too_long",
        "message": _max_track_length_error_message(max_track_length_min),
    }


def probe_audio_duration_seconds(path: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception:
        return None
    output = result.stdout.strip()
    if not output:
        return None
    try:
        duration_s = float(output)
    except ValueError:
        return None
    if not math.isfinite(duration_s) or duration_s <= 0:
        return None
    return duration_s


def probe_youtube_duration_seconds(youtube_id: str) -> float | None:
    return probe_source_duration_seconds(source_url_from_youtube_id(youtube_id))


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def should_recycle_job(job) -> bool:
    if job.status != "downloading":
        return False
    log_path = STORAGE_ROOT / "logs" / f"{job.id}.log"
    if log_path.exists():
        return True
    updated_at = parse_timestamp(job.updated_at)
    if updated_at is None:
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    age_s = (datetime.now(timezone.utc) - updated_at).total_seconds()
    return job.progress >= 25 and age_s > 30


def recycle_job(job) -> None:
    delete_job(DB_PATH, job.id)
    logger.info("Recycling stale job %s (%s)", job.id, job.status)


def message_for_progress(status: str, progress: int | None) -> str | None:
    if status == "downloading":
        return "Fetching audio"
    if status != "processing":
        return None
    if progress is None or progress < 10:
        return "Processing"
    if progress < 90:
        return "Analyzing"
    return "Wrapping up"


def _is_youtube_source_id(source_provider: str | None, source_id: str | None) -> bool:
    if source_provider != "youtube":
        return False
    if not source_id:
        return False
    return bool(YOUTUBE_ID_RE.fullmatch(source_id))


def _notify_youtube_issue(
    raw: str | None,
    source_provider: str | None,
    source_id: str | None,
    job_id: str,
) -> None:
    if not raw:
        return
    if not _is_youtube_source_id(source_provider, source_id):
        return
    topic_key = os.environ.get(NTFY_TOPIC_ENV)
    if not topic_key:
        return
    lowered = raw.lower()
    age_restricted = (
        "sign in to confirm your age" in lowered
        or "inappropriate for some users" in lowered
        or "age-restricted" in lowered
        or "age restriction" in lowered
    )
    if age_restricted:
        return
    issues: list[str] = []
    if "http error 403" in lowered or "unable to download video data" in lowered:
        issues.append("403: Forbidden")
    if "sign in to confirm" in lowered or "not a bot" in lowered:
        issues.append("Sign in to confirm you're not a bot")
    if not issues:
        return
    video_label = source_id or "unknown"
    log_path = f"/api/logs/{job_id}"
    message = (
        "[Forever Jukebox] Youtube error on "
        + video_label
        + ": "
        + " or ".join(issues)
        + " - "
        + log_path
    )
    topic_url = f"ntfy.sh/{topic_key}"
    try:
        subprocess.run(
            ["curl", "-d", message, topic_url],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return


def _write_failure_log(job_id: str, message: str) -> None:
    log_dir = STORAGE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"
    log_path.write_text(f"Job failed: {message}\n", encoding="utf-8")


def cleanup_failure(
    job_id: str,
    message: str,
    source_id: str | None = None,
    source_provider: str | None = None,
) -> None:
    _notify_youtube_issue(message, source_provider, source_id, job_id)
    _write_failure_log(job_id, message)
    for candidate in (STORAGE_ROOT / "audio").glob(f"{job_id}.*"):
        if candidate.is_file():
            candidate.unlink()
    result_path = STORAGE_ROOT / "analysis" / f"{job_id}.json"
    if result_path.is_file():
        result_path.unlink()
    set_job_status(DB_PATH, job_id, "failed", message)
    log_event(
        "job_failed",
        job_id=job_id,
        source=source_provider or "unknown",
        error_code=failure_code_for(message),
        stage="download",
    )
    logger.info("Job %s failed: %s", job_id, message)


def delete_job_artifacts(job_id: str, job) -> None:
    paths: list[Path] = []
    if job and job.input_path:
        paths.append(abs_storage_path(STORAGE_ROOT, job.input_path))
    if job and job.output_path:
        paths.append(abs_storage_path(STORAGE_ROOT, job.output_path))
    paths.append(STORAGE_ROOT / "logs" / f"{job_id}.log")
    for path in paths:
        if path.is_file():
            path.unlink()
    for candidate in (STORAGE_ROOT / "audio").glob(f"{job_id}.*"):
        if candidate.is_file():
            candidate.unlink()
    for candidate in (STORAGE_ROOT / "analysis").glob(f"{job_id}.*"):
        if candidate.is_file():
            candidate.unlink()


def download_source_audio(
    job_id: str,
    source_url: str,
    source_id: str | None = None,
    source_provider: str | None = None,
) -> None:
    try:
        from yt_dlp import YoutubeDL
    except Exception:
        cleanup_failure(job_id, "yt-dlp is not available", source_id, source_provider)
        return

    audio_dir = STORAGE_ROOT / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(audio_dir / f"{job_id}.%(ext)s")

    max_track_length_min = env_positive_float("MAX_TRACK_LENGTH")
    max_track_length_s = (
        int(round(max_track_length_min * 60)) if max_track_length_min is not None else None
    )

    last_progress = {"value": -1}

    def progress_hook(status: dict) -> None:
        if status.get("status") != "downloading":
            return
        total = status.get("total_bytes") or status.get("total_bytes_estimate")
        downloaded = status.get("downloaded_bytes") or 0
        if not total:
            return
        ratio = max(0.0, min(1.0, downloaded / total))
        progress = int(round(ratio * 25))
        if progress != last_progress["value"]:
            last_progress["value"] = progress
            set_job_progress(DB_PATH, job_id, progress)

    ydl_opts = {
        "quiet": True,
        "skip_download": False,
        "format": "bestaudio/best",
        "noplaylist": True,
        "max_filesize": 100 * 1024 * 1024,
        "outtmpl": outtmpl,
        "progress_hooks": [progress_hook],
        "extractaudio": True,
        "audioformat": "m4a",
    }
    if max_track_length_s is not None:

        def match_filter(info_dict: dict, *, incomplete: bool) -> str | None:
            if incomplete:
                return None
            duration = info_dict.get("duration")
            if isinstance(duration, (int, float)) and duration > max_track_length_s:
                return (
                    f"Track exceeds MAX_TRACK_LENGTH "
                    f"({max_track_length_min:g} minutes)"
                )
            return None

        ydl_opts["match_filter"] = match_filter
    apply_ejs_config(ydl_opts)
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)
    except Exception as exc:  # pragma: no cover - network call
        cleanup_failure(job_id, str(exc), source_id, source_provider)
        return

    job = get_job(DB_PATH, job_id)
    if job and job.source_provider != "upload" and (not job.track_title or not job.track_title.strip()):
        if isinstance(info, dict):
            info_title = info.get("track") or info.get("title")
            info_artist = info.get("artist") or info.get("uploader") or info.get("creator")
            if isinstance(info_title, str) and info_title.strip():
                _artist = info_artist if isinstance(info_artist, str) else ""
                update_job_track_metadata(DB_PATH, job_id, sanitize_title(info_title), _artist.strip())

    input_path = None
    if isinstance(info, dict):
        downloads = info.get("requested_downloads") or []
        if downloads and downloads[0].get("filepath"):
            input_path = downloads[0]["filepath"]
        elif info.get("_filename"):
            input_path = info.get("_filename")

    if input_path and not Path(input_path).is_file():
        input_path = None

    if not input_path:
        for candidate in audio_dir.glob(f"{job_id}.*"):
            if candidate.is_file():
                input_path = str(candidate)
                break

    if not input_path:
        cleanup_failure(job_id, "Download failed", source_id, source_provider)
        return

    input_path_obj = Path(input_path)
    suffix = input_path_obj.suffix or ".audio"
    relative_path = Path("audio") / f"{job_id}{suffix}"
    target_path = (STORAGE_ROOT / relative_path).resolve()
    if input_path_obj.resolve() != target_path:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(input_path_obj), str(target_path))
    update_job_input_path(DB_PATH, job_id, str(relative_path))
    set_job_progress(DB_PATH, job_id, 25)
    set_job_status(DB_PATH, job_id, "queued", None)


def download_youtube_audio(job_id: str, youtube_id: str) -> None:
    download_source_audio(job_id, source_url_from_youtube_id(youtube_id), youtube_id, "youtube")
