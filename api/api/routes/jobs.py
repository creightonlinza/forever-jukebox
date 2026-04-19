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
    get_job_by_source,
    get_job_by_source_url,
    get_job_by_track,
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
    AnalysisUrlRequest,
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
    download_source_audio,
    error_code_for,
    fallback_source_url_for_source_id,
    log_event,
    message_for_progress,
    normalize_user_source_url,
    normalize_job_error,
    parse_timestamp,
    probe_audio_duration_seconds,
    recycle_job,
    resolve_source_info,
    sanitize_title,
    source_url_from_source_id,
    should_recycle_job,
    track_too_long_detail,
)

router = APIRouter()

ADMIN_KEY_HEADER = "X-Admin-Key"
TRENDING_DEFAULT_DAYS = 5
TRENDING_DEFAULT_EXCLUDE_TOP_N = 25
TRENDING_DEFAULT_LIMIT = 25
TRENDING_MIN_PLAY_COUNT = 3
DELETE_WITHOUT_ADMIN_SECONDS = 1800
SUPPORTED_USER_SOURCE_PROVIDERS = {"youtube", "soundcloud", "bandcamp"}
SUPPORTED_SOURCE_PROVIDERS = {"youtube", "soundcloud", "bandcamp", "upload"}


def _allow_user_url() -> bool:
    return env_flag("ALLOW_USER_URL")


def _admin_key_matches(provided_key: str | None) -> bool:
    expected_key = os.environ.get("ADMIN_KEY")
    return bool(expected_key and provided_key == expected_key)


def _require_admin_key(provided_key: str | None) -> None:
    expected_key = os.environ.get("ADMIN_KEY")
    if not expected_key:
        raise HTTPException(status_code=403, detail="ADMIN_KEY is not configured")
    if not provided_key or provided_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")


def _create_source_job(
    background_tasks: BackgroundTasks,
    *,
    source_id: str,
    source_url: str,
    source_provider: str,
    track_title: str | None,
    track_artist: str | None,
    duration_s: float | None = None,
    require_user_url_enabled: bool = False,
) -> JSONResponse:
    if require_user_url_enabled and not _allow_user_url():
        raise HTTPException(status_code=403, detail="User-supplied URL jobs are disabled")

    if track_title and track_artist:
        existing_by_track = get_job_by_track(DB_PATH, track_title, track_artist)
        if existing_by_track and should_recycle_job(existing_by_track):
            recycle_job(existing_by_track)
            existing_by_track = None
        if existing_by_track and existing_by_track.status != "failed":
            log_event(
                "job_reused",
                job_id=existing_by_track.id,
                source=existing_by_track.source_provider or "unknown",
                match="by_track",
            )
            return _job_response(existing_by_track)

    existing = None
    if source_provider == "youtube" and source_id:
        existing = get_job_by_source(DB_PATH, source_provider, source_id)
    elif source_url:
        existing = get_job_by_source_url(DB_PATH, source_url)
    if existing and should_recycle_job(existing):
        recycle_job(existing)
        existing = None
    if existing and existing.status != "failed":
        log_event(
            "job_reused",
            job_id=existing.id,
            source=existing.source_provider or "unknown",
            match="by_source",
        )
        return _job_response(existing)

    max_track_length_min = env_positive_float("MAX_TRACK_LENGTH")
    if max_track_length_min is not None:
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
        source_id=source_id,
        source_provider=source_provider,
        source_url=source_url,
        progress=0,
    )
    log_event(
        "job_started",
        job_id=job_id,
        source=source_provider,
        source_id=source_id,
        source_url=source_url,
    )
    background_tasks.add_task(download_source_audio, job_id, source_url, source_id, source_provider)
    response_source_id = source_id if source_provider == "youtube" else None
    response_payload = AnalysisStartResponse(
        id=job_id,
        status="downloading",
        source_id=response_source_id,
        source_provider=source_provider,
        progress=None,
        message=message_for_progress("downloading", None),
    )
    return JSONResponse(response_payload.model_dump(), status_code=202)


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
    if not job.source_id:
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
        log_event(
            "auto_repair",
            job_id=job.id,
            source=job.source_provider or "unknown",
            trigger="analysis_missing",
            result="queued",
        )
    elif audio_missing and job.source_id:
        source_url = (
            job.source_url
            or source_url_from_source_id(job.source_provider, job.source_id)
            or fallback_source_url_for_source_id(job.source_id)
        )
        if not source_url:
            log_event(
                "auto_repair",
                job_id=job.id,
                source=job.source_provider or "unknown",
                trigger="audio_missing",
                result="skipped_no_source_url",
            )
            refreshed_job = get_job(DB_PATH, job.id)
            return refreshed_job or job
        set_job_progress(DB_PATH, job.id, 0)
        set_job_status(DB_PATH, job.id, "downloading", None)
        background_tasks.add_task(
            download_source_audio,
            job.id,
            source_url,
            job.source_id,
            job.source_provider,
        )
        log_event(
            "auto_repair",
            job_id=job.id,
            source=job.source_provider or "unknown",
            trigger="audio_missing",
            result="redownload_started",
        )
    elif audio_missing:
        log_event(
            "auto_repair",
            job_id=job.id,
            source=job.source_provider or "unknown",
            trigger="audio_missing",
            result="skipped_no_source_id",
        )

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
        "source_id": job.source_id,
        "source_provider": job.source_provider,
        "created_at": job.created_at,
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
    source_url = source_url_from_source_id("youtube", youtube_id)
    if not source_url:
        raise HTTPException(status_code=400, detail="Invalid YouTube ID")
    track_title = payload.title
    track_artist = payload.artist
    duration_s = None

    max_track_length_min = env_positive_float("MAX_TRACK_LENGTH")
    if max_track_length_min is not None:
        try:
            duration_s = resolve_source_info(source_url).duration_s
        except Exception:
            duration_s = None
    return _create_source_job(
        background_tasks,
        source_id=youtube_id,
        source_url=source_url,
        source_provider="youtube",
        track_title=track_title,
        track_artist=track_artist,
        duration_s=duration_s,
    )


@router.post("/api/analysis/url")
def create_analysis_url(
    background_tasks: BackgroundTasks,
    payload: AnalysisUrlRequest,
) -> JSONResponse:
    if not _allow_user_url():
        raise HTTPException(status_code=403, detail="User-supplied URL jobs are disabled")
    raw_url = payload.url.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="url is required")
    normalized_url = normalize_user_source_url(raw_url)
    if not normalized_url:
        raise HTTPException(status_code=400, detail="Invalid or unsupported URL")
    try:
        source_info = resolve_source_info(normalized_url)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to process URL: {exc}") from exc

    if source_info.provider not in SUPPORTED_USER_SOURCE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported URL provider")
    return _create_source_job(
        background_tasks,
        source_id=source_info.source_id,
        source_url=source_info.source_url,
        source_provider=source_info.provider,
        track_title=payload.title,
        track_artist=payload.artist,
        duration_s=source_info.duration_s,
        require_user_url_enabled=True,
    )


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
        source_id=None,
        source_provider="upload",
        progress=0,
    )
    log_event(
        "job_started",
        job_id=job_id,
        source="upload",
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
) -> JSONResponse:
    items = get_top_tracks(
        DB_PATH,
        limit=limit,
    )
    payload = TopSongsResponse(items=items)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/trending")
def get_trending_songs(
    limit: int = Query(TRENDING_DEFAULT_LIMIT, ge=1, le=50),
) -> JSONResponse:
    items = get_top_tracks(
        DB_PATH,
        limit=limit,
        touched_within_days=TRENDING_DEFAULT_DAYS,
        exclude_top_n=TRENDING_DEFAULT_EXCLUDE_TOP_N,
        min_play_count=TRENDING_MIN_PLAY_COUNT,
    )
    payload = TopSongsResponse(items=items)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/recent")
def get_recent_songs(limit: int = Query(10, ge=1, le=50)) -> JSONResponse:
    items = get_recent_tracks(DB_PATH, limit=limit)
    payload = RecentSongsResponse(items=items)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/jobs/by-source/{source_provider}/{source_id:path}")
def get_job_by_source_route(
    source_provider: str,
    source_id: str,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    provider = source_provider.strip().lower()
    if provider not in SUPPORTED_SOURCE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported source provider")
    source_key = source_id.strip()
    if not source_key:
        raise HTTPException(status_code=400, detail="source_id is required")
    job = get_job_by_source(DB_PATH, provider, source_key)
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
    log_event(
        "job_reused",
        job_id=job.id,
        source=job.source_provider or "unknown",
        match="by_track_lookup",
    )
    return _response_with_auto_repair(job, background_tasks)


@router.delete("/api/jobs/{job_id}")
def delete_job_by_id(
    job_id: str,
    admin_key: str | None = Header(None, alias=ADMIN_KEY_HEADER),
) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    is_admin_delete = _admin_key_matches(admin_key)
    if not is_admin_delete:
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
    log_event(
        "job_deleted",
        job_id=job_id,
        source=job.source_provider or "unknown",
        delete_mode="admin" if is_admin_delete else "window",
    )
    return JSONResponse({"status": "deleted", "id": job_id}, status_code=200)
