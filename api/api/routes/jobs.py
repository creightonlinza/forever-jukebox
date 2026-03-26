"""Job-related routes and helpers."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from ..db import (
    create_job,
    delete_job,
    get_job,
    get_job_by_track,
    get_job_by_youtube_id,
    get_recent_tracks,
    get_top_tracks,
    increment_job_plays,
    set_job_play_count,
    set_job_progress,
    set_job_status,
    update_job_input_path,
    update_job_track_metadata,
)
from ..models import (
    AnalysisStartResponse,
    JobComplete,
    JobError,
    JobProgress,
    PlayCountResponse,
    PlayCountUpdate,
    RecentSongsResponse,
    TopSongsResponse,
)
from ..paths import DB_PATH, STORAGE_ROOT
from ..utils import abs_storage_path, get_logger
from ..ytdlp_config import apply_ejs_config

ERROR_ENGINE = "ERROR: [engine] Analysis engine encountered an issue."
ERROR_YOUTUBE_UNAVAILABLE = "ERROR: [youtube] This video is not available."
ERROR_DOWNLOAD_UNAVAILABLE = "ERROR: [download] This video is not available."
ERROR_YOUTUBE_UNREACHABLE = "ERROR: [youtube] Unable to reach YouTube"
ERROR_TRACK_TOO_LONG = "ERROR: [track_length] This track exceeds the server length limit."
ERROR_GENERIC = "ERROR: Something went wrong. Please try again or report an issue on GitHub."
ERROR_CODE_ANALYSIS_MISSING = "analysis_missing"
NTFY_TOPIC_ENV = "NTFY_TOPIC_KEY"
TRENDING_DEFAULT_DAYS = 5
TRENDING_DEFAULT_EXCLUDE_TOP_N = 25
TRENDING_DEFAULT_LIMIT = 25


def _normalize_job_error(raw: str | None) -> str:
    if not raw:
        return ERROR_GENERIC
    lowered = raw.lower()
    if "engine exited" in lowered:
        return ERROR_ENGINE
    if "video unavailable" in lowered or "this video is not available" in lowered:
        return ERROR_YOUTUBE_UNAVAILABLE
    if "http error 403" in lowered or "[download]" in lowered or "unable to download video data" in lowered:
        return ERROR_DOWNLOAD_UNAVAILABLE
    if "sign in to confirm" in lowered or "not a bot" in lowered:
        return ERROR_YOUTUBE_UNREACHABLE
    if "max_track_length" in lowered or "track exceeds max track length" in lowered:
        return ERROR_TRACK_TOO_LONG
    if "max track length for this server is" in lowered:
        return ERROR_TRACK_TOO_LONG
    return ERROR_GENERIC


def _error_code_for(raw: str | None) -> str | None:
    if not raw:
        return None
    if raw == "Analysis missing":
        return ERROR_CODE_ANALYSIS_MISSING
    return None


def _notify_youtube_issue(raw: str | None, youtube_id: str | None, job_id: str) -> None:
    if not raw:
        return
    topic_key = os.environ.get(NTFY_TOPIC_ENV)
    if not topic_key:
        return
    lowered = raw.lower()
    issues: list[str] = []
    if "http error 403" in lowered or "unable to download video data" in lowered:
        issues.append("403: Forbidden")
    if "sign in to confirm" in lowered or "not a bot" in lowered:
        issues.append("Sign in to confirm you're not a bot")
    if not issues:
        return
    video_label = youtube_id or "unknown"
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

router = APIRouter()
logger = get_logger()

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_UPLOAD_EXTS = {".m4a", ".webm", ".mp3", ".wav", ".flac", ".ogg", ".aac"}


def _sanitize_title(filename: str | None) -> str:
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


def _log_event(event: str, **fields: object) -> None:
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


def _is_enabled(env_key: str) -> bool:
    value = os.environ.get(env_key, "")
    return value.lower() in {"1", "true", "yes", "on"}


def _env_positive_float(env_key: str) -> float | None:
    value = os.environ.get(env_key)
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    if parsed <= 0:
        return None
    return parsed


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


def _probe_audio_duration_seconds(path: Path) -> float | None:
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


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _should_recycle_job(job) -> bool:
    if job.status != "downloading":
        return False
    log_path = STORAGE_ROOT / "logs" / f"{job.id}.log"
    if log_path.exists():
        return True
    updated_at = _parse_timestamp(job.updated_at)
    if updated_at is None:
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    age_s = (datetime.now(timezone.utc) - updated_at).total_seconds()
    return job.progress >= 25 and age_s > 30


def _recycle_job(job) -> None:
    delete_job(DB_PATH, job.id)
    logger.info("Recycling stale job %s (%s)", job.id, job.status)


def _message_for_progress(status: str, progress: int | None) -> str | None:
    if status == "downloading":
        return "Fetching audio"
    if status == "queued":
        return "Queued"
    if status != "processing":
        return None
    if progress is None or progress < 10:
        return "Processing"
    if progress < 90:
        return "Analyzing"
    return "Wrapping up"


def _job_response(job) -> JSONResponse:
    base_payload = {
        "id": job.id,
        "youtube_id": job.youtube_id,
        "created_at": job.created_at,
        "is_user_supplied": bool(job.is_user_supplied),
    }
    if job.status in {"queued", "processing", "downloading"}:
        progress = job.progress if job.status == "processing" else None
        message = _message_for_progress(job.status, progress)
        payload = JobProgress(
            status=job.status,
            progress=progress,
            message=message,
            **base_payload,
        )
        return JSONResponse(payload.model_dump(), status_code=202)

    if job.status == "failed":
        payload = JobError(
            status="failed",
            error=_normalize_job_error(job.error),
            error_code=_error_code_for(job.error),
            **base_payload,
        )
        return JSONResponse(payload.model_dump(), status_code=200)

    result_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    if not result_path.exists():
        payload = JobError(
            status="failed",
            error=_normalize_job_error("Analysis missing"),
            error_code=_error_code_for("Analysis missing"),
            **base_payload,
        )
        return JSONResponse(payload.model_dump(), status_code=200)

    data = json.loads(result_path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and (job.track_title or job.track_artist):
        track = data.get("track")
        if not isinstance(track, dict):
            track = {}
            data["track"] = track
        if job.track_title and not track.get("title"):
            track["title"] = job.track_title
        if job.track_artist and not track.get("artist"):
            track["artist"] = job.track_artist
    payload = JobComplete(status="complete", result=data, progress=job.progress, **base_payload)
    return JSONResponse(payload.model_dump(), status_code=200)


def _write_failure_log(job_id: str, message: str) -> None:
    log_dir = STORAGE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"
    log_path.write_text(f"Job failed: {message}\n", encoding="utf-8")


def _cleanup_failure(job_id: str, message: str, youtube_id: str | None = None) -> None:
    _notify_youtube_issue(message, youtube_id, job_id)
    _write_failure_log(job_id, message)
    for candidate in (STORAGE_ROOT / "audio").glob(f"{job_id}.*"):
        if candidate.is_file():
            candidate.unlink()
    result_path = STORAGE_ROOT / "analysis" / f"{job_id}.json"
    if result_path.is_file():
        result_path.unlink()
    delete_job(DB_PATH, job_id)
    logger.info("Job %s failed: %s", job_id, message)


def _delete_job_artifacts(job_id: str, job) -> None:
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


def _download_youtube_audio(job_id: str, youtube_id: str) -> None:
    try:
        from yt_dlp import YoutubeDL
    except Exception:
        _cleanup_failure(job_id, "yt-dlp is not available", youtube_id)
        return

    audio_dir = STORAGE_ROOT / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(audio_dir / f"{job_id}.%(ext)s")

    max_track_length_min = _env_positive_float("MAX_TRACK_LENGTH")
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
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:  # pragma: no cover - network call
        _cleanup_failure(job_id, str(exc), youtube_id)
        return

    job = get_job(DB_PATH, job_id)
    if job and job.is_user_supplied and (not job.track_title or not job.track_title.strip()):
        if isinstance(info, dict):
            info_title = info.get("title")
            if isinstance(info_title, str) and info_title.strip():
                update_job_track_metadata(
                    DB_PATH, job_id, _sanitize_title(info_title), ""
                )

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
        _cleanup_failure(job_id, "Download failed", youtube_id)
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


@router.get("/api/analysis/{job_id}")
def get_analysis(job_id: str) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.post("/api/repair/{job_id}")
def repair_job(job_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in {"downloading", "queued", "processing"}:
        return _job_response(job)

    audio_path = None
    if job.input_path:
        audio_path = abs_storage_path(STORAGE_ROOT, job.input_path)
    if not audio_path or not audio_path.exists():
        candidates = sorted((STORAGE_ROOT / "audio").glob(f"{job_id}.*"))
        if candidates:
            candidate = candidates[0]
            relative_path = Path("audio") / candidate.name
            update_job_input_path(DB_PATH, job_id, str(relative_path))
            audio_path = candidate

    analysis_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    audio_missing = not audio_path or not audio_path.exists()
    analysis_missing = not analysis_path.exists()

    if analysis_missing and not audio_missing:
        set_job_progress(DB_PATH, job_id, 25)
        set_job_status(DB_PATH, job_id, "queued", None)
        job = get_job(DB_PATH, job_id)
        return _job_response(job) if job else JSONResponse(
            JobError(status="failed", error="Job not found", id=job_id, youtube_id=None).model_dump(),
            status_code=404,
        )

    if audio_missing:
        if not job.youtube_id:
            raise HTTPException(status_code=404, detail="Job is missing youtube_id")
        set_job_progress(DB_PATH, job_id, 0)
        set_job_status(DB_PATH, job_id, "downloading", None)
        background_tasks.add_task(_download_youtube_audio, job_id, job.youtube_id)
        job = get_job(DB_PATH, job_id)
        return _job_response(job) if job else JSONResponse(
            JobError(status="failed", error="Job not found", id=job_id, youtube_id=None).model_dump(),
            status_code=404,
        )

    return _job_response(job)


@router.post("/api/analysis/youtube")
def create_analysis_youtube(
    background_tasks: BackgroundTasks, payload: dict = Body(...)
) -> JSONResponse:
    youtube_id = payload.get("youtube_id")
    if not youtube_id or not isinstance(youtube_id, str):
        raise HTTPException(status_code=400, detail="youtube_id is required")
    track_title = payload.get("title")
    track_artist = payload.get("artist")
    is_user_supplied = bool(payload.get("is_user_supplied"))
    if track_title is not None and not isinstance(track_title, str):
        raise HTTPException(status_code=400, detail="title must be a string")
    if track_artist is not None and not isinstance(track_artist, str):
        raise HTTPException(status_code=400, detail="artist must be a string")

    if is_user_supplied and not _is_enabled("ALLOW_USER_YOUTUBE"):
        raise HTTPException(status_code=403, detail="User-supplied YouTube jobs are disabled")

    if track_title and track_artist:
        existing_by_track = get_job_by_track(DB_PATH, track_title, track_artist)
        if existing_by_track and _should_recycle_job(existing_by_track):
            _recycle_job(existing_by_track)
            existing_by_track = None
        if existing_by_track and existing_by_track.status != "failed":
            return _job_response(existing_by_track)

    existing = get_job_by_youtube_id(DB_PATH, youtube_id)
    if existing and _should_recycle_job(existing):
        _recycle_job(existing)
        existing = None
    if existing and existing.status != "failed":
        return _job_response(existing)

    job_id = uuid.uuid4().hex
    output_path = Path("analysis") / f"{job_id}.json"

    create_job(
        DB_PATH,
        job_id,
        "",
        str(output_path),
        status="downloading",
        track_title=track_title,
        track_artist=track_artist,
        youtube_id=youtube_id,
        progress=0,
        is_user_supplied=int(is_user_supplied),
    )
    _log_event(
        "job_started",
        job_id=job_id,
        source="youtube",
        youtube_id=youtube_id,
        is_user_supplied=is_user_supplied,
    )
    background_tasks.add_task(_download_youtube_audio, job_id, youtube_id)
    payload = AnalysisStartResponse(
        id=job_id,
        status="downloading",
        progress=None,
        message=_message_for_progress("downloading", None),
    )
    return JSONResponse(payload.model_dump(), status_code=202)


@router.post("/api/upload")
async def upload_audio(file: UploadFile = File(...)) -> JSONResponse:
    if not _is_enabled("ALLOW_USER_UPLOAD"):
        raise HTTPException(status_code=403, detail="User uploads are disabled")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    job_id = uuid.uuid4().hex
    audio_dir = STORAGE_ROOT / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    relative_path = Path("audio") / f"{job_id}{ext}"
    target_path = (STORAGE_ROOT / relative_path).resolve()

    total = 0
    try:
        with target_path.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                handle.write(chunk)
    except HTTPException:
        if target_path.exists():
            target_path.unlink()
        raise
    finally:
        await file.close()

    max_track_length_min = _env_positive_float("MAX_TRACK_LENGTH")
    if max_track_length_min is not None:
        duration_s = _probe_audio_duration_seconds(target_path)
        if duration_s is None:
            if target_path.exists():
                target_path.unlink()
            raise HTTPException(status_code=500, detail="Unable to validate uploaded audio duration")
        if duration_s > max_track_length_min * 60:
            if target_path.exists():
                target_path.unlink()
            raise HTTPException(
                status_code=422,
                detail={
                    "error_code": "track_too_long",
                    "message": _max_track_length_error_message(max_track_length_min),
                },
            )

    title = _sanitize_title(file.filename)
    output_path = Path("analysis") / f"{job_id}.json"
    create_job(
        DB_PATH,
        job_id,
        str(relative_path),
        str(output_path),
        status="queued",
        track_title=title,
        track_artist="",
        youtube_id=None,
        progress=0,
        is_user_supplied=1,
    )
    _log_event(
        "job_started",
        job_id=job_id,
        source="upload",
        is_user_supplied=True,
        upload_ext=ext,
    )
    payload = AnalysisStartResponse(
        id=job_id,
        status="queued",
        progress=None,
        message=_message_for_progress("queued", None),
    )
    return JSONResponse(payload.model_dump(), status_code=202)


@router.post("/api/plays/{job_id}")
def increment_play_count(job_id: str) -> JSONResponse:
    play_count = increment_job_plays(DB_PATH, job_id)
    if play_count is None:
        raise HTTPException(status_code=404, detail="Job not found")
    payload = PlayCountResponse(id=job_id, play_count=play_count)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.patch("/api/plays/{job_id}")
def set_play_count(
    job_id: str,
    payload: PlayCountUpdate = Body(...),
    key: str | None = Query(None),
) -> JSONResponse:
    expected_key = os.environ.get("ADMIN_KEY")
    if not expected_key:
        raise HTTPException(status_code=403, detail="ADMIN_KEY is not configured")
    provided_key = key
    if not provided_key or provided_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")
    play_count = set_job_play_count(DB_PATH, job_id, payload.play_count)
    if play_count is None:
        raise HTTPException(status_code=404, detail="Job not found")
    response = PlayCountResponse(id=job_id, play_count=play_count)
    return JSONResponse(response.model_dump(), status_code=200)


@router.get("/api/top")
def get_top_songs(
    limit: int = Query(10, ge=1, le=50),
    days: int | None = Query(
        None,
        ge=1,
        le=3650,
        deprecated=True,
        description="Deprecated on /api/top. Use /api/trending instead.",
    ),
    exclude_top_n: int | None = Query(
        None,
        ge=1,
        le=500,
        deprecated=True,
        description="Deprecated on /api/top. Use /api/trending instead.",
    ),
) -> JSONResponse:
    items = get_top_tracks(
        DB_PATH,
        limit=limit,
        touched_within_days=days,
        exclude_top_n=exclude_top_n,
    )
    payload = TopSongsResponse(items=items)
    headers: dict[str, str] | None = None
    if days is not None or exclude_top_n is not None:
        headers = {
            "Deprecation": "true",
            "Link": '</api/trending>; rel="successor-version"',
        }
    return JSONResponse(payload.model_dump(), status_code=200, headers=headers)


@router.get("/api/trending")
def get_trending_songs(
    limit: int = Query(TRENDING_DEFAULT_LIMIT, ge=1, le=50),
) -> JSONResponse:
    items = get_top_tracks(
        DB_PATH,
        limit=limit,
        touched_within_days=TRENDING_DEFAULT_DAYS,
        exclude_top_n=TRENDING_DEFAULT_EXCLUDE_TOP_N,
    )
    payload = TopSongsResponse(items=items)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/recent")
def get_recent_songs(limit: int = Query(10, ge=1, le=50)) -> JSONResponse:
    items = get_recent_tracks(DB_PATH, limit=limit)
    payload = RecentSongsResponse(items=items)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/jobs/by-youtube/{youtube_id}")
def get_job_by_youtube(youtube_id: str) -> JSONResponse:
    job = get_job_by_youtube_id(DB_PATH, youtube_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if _should_recycle_job(job):
        _recycle_job(job)
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.get("/api/jobs/by-track")
def get_job_by_track_match(
    title: str = Query(..., min_length=1), artist: str = Query(..., min_length=1)
) -> JSONResponse:
    _log_event("spotify_selection", title=title, artist=artist)
    job = get_job_by_track(DB_PATH, title, artist)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if _should_recycle_job(job):
        _recycle_job(job)
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.delete("/api/jobs/{job_id}")
def delete_job_by_id(
    job_id: str,
    key: str | None = Query(None),
) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    expected_key = os.environ.get("ADMIN_KEY")
    provided_key = key
    has_admin_key = bool(expected_key and provided_key == expected_key)
    if not has_admin_key:
        created_at = _parse_timestamp(job.created_at)
        completion_time = None
        if job.status == "complete" and job.output_path:
            result_path = abs_storage_path(STORAGE_ROOT, job.output_path)
            if result_path.exists():
                completion_time = datetime.fromtimestamp(result_path.stat().st_mtime, tz=timezone.utc)
        now = datetime.now(timezone.utc)
        within_window = False
        if created_at is not None:
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            within_window = within_window or (now - created_at).total_seconds() <= 1800
        if completion_time is not None:
            within_window = within_window or (now - completion_time).total_seconds() <= 1800
        if not within_window:
            raise HTTPException(status_code=403, detail="Invalid admin key")

    _delete_job_artifacts(job_id, job)
    delete_job(DB_PATH, job_id)
    return JSONResponse({"status": "deleted", "id": job_id}, status_code=200)
