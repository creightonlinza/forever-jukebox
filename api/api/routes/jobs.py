"""Job-related routes."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from ..db import (
    count_queued_jobs_ahead,
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
)
from ..env import env_flag, env_positive_float
from ..models import (
    AnalysisStartResponse,
    AnalysisYoutubeRequest,
    JobComplete,
    JobError,
    JobProgress,
    PlayCountResponse,
    PlayCountUpdate,
    RecentSongsResponse,
    TopSongsResponse,
)
from ..paths import DB_PATH, STORAGE_ROOT
from ..utils import abs_storage_path
from .jobs_runtime import (
    ALLOWED_UPLOAD_EXTS,
    ANALYSIS_MISSING_MESSAGE,
    MAX_UPLOAD_BYTES,
    delete_job_artifacts,
    download_youtube_audio,
    error_code_for,
    log_event,
    message_for_progress,
    normalize_job_error,
    parse_timestamp,
    probe_audio_duration_seconds,
    probe_youtube_duration_seconds,
    recycle_job,
    sanitize_title,
    should_recycle_job,
    track_too_long_detail,
)

router = APIRouter()

ADMIN_KEY_HEADER = "X-Admin-Key"
TRENDING_DEFAULT_DAYS = 5
TRENDING_DEFAULT_EXCLUDE_TOP_N = 25
TRENDING_DEFAULT_LIMIT = 25
DELETE_WITHOUT_ADMIN_SECONDS = 1800


def _admin_key_matches(provided_key: str | None) -> bool:
    expected_key = os.environ.get("ADMIN_KEY")
    return bool(expected_key and provided_key == expected_key)


def _require_admin_key(provided_key: str | None) -> None:
    expected_key = os.environ.get("ADMIN_KEY")
    if not expected_key:
        raise HTTPException(status_code=403, detail="ADMIN_KEY is not configured")
    if not provided_key or provided_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")


def _queued_message(job) -> str:
    ahead = count_queued_jobs_ahead(DB_PATH, job.id, job.created_at)
    if ahead <= 0:
        return "Queued • Next in line"
    return f"Queued • {ahead} ahead of you"


def _find_audio_path(job) -> Path | None:
    if job.input_path:
        configured_path = abs_storage_path(STORAGE_ROOT, job.input_path)
        if configured_path.exists():
            return configured_path
    candidates = sorted((STORAGE_ROOT / "audio").glob(f"{job.id}.*"))
    if candidates:
        return candidates[0]
    return None


def _ensure_audio_path(job) -> Path | None:
    audio_path = _find_audio_path(job)
    if not audio_path:
        return None
    if job.input_path:
        configured_path = abs_storage_path(STORAGE_ROOT, job.input_path)
        if configured_path == audio_path:
            return audio_path
    relative_path = Path("audio") / audio_path.name
    update_job_input_path(DB_PATH, job.id, str(relative_path))
    return audio_path


def _should_attempt_auto_repair(job) -> bool:
    if job.status in {"downloading", "queued", "processing"}:
        return False
    if job.status == "failed":
        return job.error == ANALYSIS_MISSING_MESSAGE
    result_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    if not result_path.exists():
        return True
    if not job.youtube_id:
        return False
    return _find_audio_path(job) is None


def _attempt_auto_repair(job, background_tasks: BackgroundTasks):
    if job.status in {"downloading", "queued", "processing"}:
        return job

    audio_path = _ensure_audio_path(job)
    analysis_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    audio_missing = not audio_path or not audio_path.exists()
    analysis_missing = not analysis_path.exists()

    if analysis_missing and not audio_missing:
        set_job_progress(DB_PATH, job.id, 25)
        set_job_status(DB_PATH, job.id, "queued", None)
    elif audio_missing and job.youtube_id:
        set_job_progress(DB_PATH, job.id, 0)
        set_job_status(DB_PATH, job.id, "downloading", None)
        background_tasks.add_task(download_youtube_audio, job.id, job.youtube_id)

    refreshed_job = get_job(DB_PATH, job.id)
    return refreshed_job or job


def _response_with_auto_repair(job, background_tasks: BackgroundTasks) -> JSONResponse:
    if not _should_attempt_auto_repair(job):
        return _job_response(job)
    repaired_job = _attempt_auto_repair(job, background_tasks)
    return _job_response(repaired_job)


def _job_response(job) -> JSONResponse:
    base_payload = {
        "id": job.id,
        "youtube_id": job.youtube_id,
        "created_at": job.created_at,
        "is_user_supplied": bool(job.is_user_supplied),
    }
    if job.status in {"queued", "processing", "downloading"}:
        progress = job.progress if job.status == "processing" else None
        message = (
            _queued_message(job)
            if job.status == "queued"
            else message_for_progress(job.status, progress)
        )
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
            error=normalize_job_error(job.error),
            error_code=error_code_for(job.error),
            **base_payload,
        )
        return JSONResponse(payload.model_dump(), status_code=200)

    result_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    if not result_path.exists():
        payload = JobError(
            status="failed",
            error=normalize_job_error(ANALYSIS_MISSING_MESSAGE),
            error_code=error_code_for(ANALYSIS_MISSING_MESSAGE),
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


@router.get("/api/analysis/{job_id}")
def get_analysis(job_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _response_with_auto_repair(job, background_tasks)


@router.post("/api/analysis/youtube")
def create_analysis_youtube(
    background_tasks: BackgroundTasks,
    payload: AnalysisYoutubeRequest,
) -> JSONResponse:
    youtube_id = payload.youtube_id.strip()
    if not youtube_id:
        raise HTTPException(status_code=400, detail="youtube_id is required")
    track_title = payload.title
    track_artist = payload.artist
    is_user_supplied = payload.is_user_supplied

    if is_user_supplied and not env_flag("ALLOW_USER_YOUTUBE"):
        raise HTTPException(status_code=403, detail="User-supplied YouTube jobs are disabled")

    if track_title and track_artist:
        existing_by_track = get_job_by_track(DB_PATH, track_title, track_artist)
        if existing_by_track and should_recycle_job(existing_by_track):
            recycle_job(existing_by_track)
            existing_by_track = None
        if existing_by_track and existing_by_track.status != "failed":
            return _job_response(existing_by_track)

    existing = get_job_by_youtube_id(DB_PATH, youtube_id)
    if existing and should_recycle_job(existing):
        recycle_job(existing)
        existing = None
    if existing and existing.status != "failed":
        return _job_response(existing)

    max_track_length_min = env_positive_float("MAX_TRACK_LENGTH")
    if is_user_supplied and max_track_length_min is not None:
        duration_s = probe_youtube_duration_seconds(youtube_id)
        if duration_s is not None and duration_s > max_track_length_min * 60:
            raise HTTPException(
                status_code=422,
                detail=track_too_long_detail(max_track_length_min),
            )

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
    log_event(
        "job_started",
        job_id=job_id,
        source="youtube",
        youtube_id=youtube_id,
        is_user_supplied=is_user_supplied,
    )
    background_tasks.add_task(download_youtube_audio, job_id, youtube_id)
    response_payload = AnalysisStartResponse(
        id=job_id,
        status="downloading",
        progress=None,
        message=message_for_progress("downloading", None),
    )
    return JSONResponse(response_payload.model_dump(), status_code=202)


@router.post("/api/upload")
async def upload_audio(file: UploadFile = File(...)) -> JSONResponse:
    if not env_flag("ALLOW_USER_UPLOAD"):
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

    max_track_length_min = env_positive_float("MAX_TRACK_LENGTH")
    if max_track_length_min is not None:
        duration_s = probe_audio_duration_seconds(target_path)
        if duration_s is None:
            if target_path.exists():
                target_path.unlink()
            raise HTTPException(status_code=500, detail="Unable to validate uploaded audio duration")
        if duration_s > max_track_length_min * 60:
            if target_path.exists():
                target_path.unlink()
            raise HTTPException(
                status_code=422,
                detail=track_too_long_detail(max_track_length_min),
            )

    title = sanitize_title(file.filename)
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
    log_event(
        "job_started",
        job_id=job_id,
        source="upload",
        is_user_supplied=True,
        upload_ext=ext,
    )
    job = get_job(DB_PATH, job_id)
    if job:
        return _job_response(job)
    response_payload = AnalysisStartResponse(
        id=job_id,
        status="queued",
        progress=None,
        message="Queued • Next in line",
    )
    return JSONResponse(response_payload.model_dump(), status_code=202)


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
    payload: PlayCountUpdate,
    admin_key: str | None = Header(None, alias=ADMIN_KEY_HEADER),
) -> JSONResponse:
    _require_admin_key(admin_key)
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
def get_job_by_youtube(youtube_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    job = get_job_by_youtube_id(DB_PATH, youtube_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if should_recycle_job(job):
        recycle_job(job)
        raise HTTPException(status_code=404, detail="Job not found")
    return _response_with_auto_repair(job, background_tasks)


@router.get("/api/jobs/by-track")
def get_job_by_track_match(
    background_tasks: BackgroundTasks,
    title: str = Query(..., min_length=1),
    artist: str = Query(..., min_length=1),
) -> JSONResponse:
    log_event("spotify_selection", title=title, artist=artist)
    job = get_job_by_track(DB_PATH, title, artist)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if should_recycle_job(job):
        recycle_job(job)
        raise HTTPException(status_code=404, detail="Job not found")
    return _response_with_auto_repair(job, background_tasks)


@router.delete("/api/jobs/{job_id}")
def delete_job_by_id(
    job_id: str,
    admin_key: str | None = Header(None, alias=ADMIN_KEY_HEADER),
) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not _admin_key_matches(admin_key):
        created_at = parse_timestamp(job.created_at)
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
            within_window = within_window or (
                now - created_at
            ).total_seconds() <= DELETE_WITHOUT_ADMIN_SECONDS
        if completion_time is not None:
            within_window = within_window or (
                now - completion_time
            ).total_seconds() <= DELETE_WITHOUT_ADMIN_SECONDS
        if not within_window:
            raise HTTPException(status_code=403, detail="Invalid admin key")

    delete_job_artifacts(job_id, job)
    delete_job(DB_PATH, job_id)
    return JSONResponse({"status": "deleted", "id": job_id}, status_code=200)
