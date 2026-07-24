"""Job-related routes."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, BackgroundTasks, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from ..admin_auth import ADMIN_KEY_HEADER, admin_key_matches, require_admin_key
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
    restart_failed_job,
    set_job_play_count,
    set_job_progress,
    set_job_status,
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
from ..route_responses import error_responses
from ..utils import audio_path_for, read_analysis_json, resolve_analysis_path
from .jobs_runtime import (
    ALLOWED_UPLOAD_EXTS,
    ANALYSIS_MISSING_MESSAGE,
    ERROR_GENERIC,
    MAX_UPLOAD_BYTES,
    delete_job_artifacts,
    download_source_audio,
    error_code_for,
    fallback_source_url_for_source_id,
    is_retryable_download_error,
    log_event,
    message_for_progress,
    normalize_job_error,
    normalize_user_source_url,
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

TRENDING_DEFAULT_DAYS = 5
TRENDING_DEFAULT_EXCLUDE_TOP_N = 25
TRENDING_DEFAULT_LIMIT = 25
TRENDING_MIN_PLAY_COUNT = 3
DELETE_WITHOUT_ADMIN_SECONDS = 1800
SUPPORTED_USER_SOURCE_PROVIDERS = {"youtube", "soundcloud", "bandcamp"}
SUPPORTED_SOURCE_PROVIDERS = {"youtube", "soundcloud", "bandcamp", "upload"}
JOB_NOT_FOUND_DETAIL = "Job not found"


def _allow_user_url() -> bool:
    return env_flag("ALLOW_USER_URL")


def _source_url_for_job(job) -> str | None:
    return (
        job.source_url
        or source_url_from_source_id(job.source_provider, job.source_id)
        or fallback_source_url_for_source_id(job.source_id)
    )


def _source_identity_from_url(source_url: str) -> tuple[str | None, str | None]:
    parsed = urlsplit(source_url)
    host = (parsed.hostname or "").lower()
    if host == "youtu.be" or host.endswith(".youtu.be"):
        source_id = parsed.path.strip("/").split("/", 1)[0].strip()
        return "youtube", source_id or None
    if host == "youtube.com" or host.endswith(".youtube.com"):
        query_id = parse_qs(parsed.query).get("v", [None])[0]
        if query_id:
            return "youtube", query_id.strip() or None
        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
            return "youtube", path_parts[1].strip() or None
        return "youtube", None
    if host == "soundcloud.com" or host.endswith(".soundcloud.com"):
        return "soundcloud", None
    if host == "bandcamp.com" or host.endswith(".bandcamp.com"):
        return "bandcamp", None
    return None, None


def _find_existing_source_job(source_provider: str | None, source_id: str | None, source_url: str):
    if source_provider == "youtube" and source_id:
        existing = get_job_by_source(DB_PATH, source_provider, source_id)
        if existing:
            return existing
    return get_job_by_source_url(DB_PATH, source_url)


def _resolution_failure_detail(error: Exception) -> dict[str, str]:
    raw = str(error)
    message = normalize_job_error(raw)
    if message == ERROR_GENERIC:
        message = ERROR_GENERIC
    detail = {"message": message}
    code = error_code_for(raw)
    if code:
        detail["error_code"] = code
    return detail


def _is_retryable_failed_job(job) -> bool:
    return job.status == "failed" and is_retryable_download_error(job.error)


def _restart_retryable_failed_job(
    job,
    background_tasks: BackgroundTasks,
    *,
    match: str,
):
    if job.status != "failed" or not is_retryable_download_error(job.error):
        return job
    source_url = _source_url_for_job(job)
    if not source_url:
        log_event(
            "job_retry_skipped",
            job_id=job.id,
            source=job.source_provider or "unknown",
            match=match,
            reason="missing_source_url",
        )
        return job
    retry_claimed = restart_failed_job(DB_PATH, job.id, job.updated_at)
    if retry_claimed:
        delete_job_artifacts(job.id, storage_root=STORAGE_ROOT)
        background_tasks.add_task(
            download_source_audio,
            job.id,
            source_url,
            job.source_id,
            job.source_provider,
        )
        log_event(
            "job_retry_started",
            job_id=job.id,
            source=job.source_provider or "unknown",
            match=match,
            previous_error_code=error_code_for(job.error),
        )
    refreshed_job = get_job(DB_PATH, job.id)
    if refreshed_job:
        return refreshed_job
    log_event(
        "job_retry_refresh_failed",
        job_id=job.id,
        source=job.source_provider or "unknown",
        match=match,
    )
    return job


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
        if existing_by_track:
            existing_by_track = _restart_retryable_failed_job(
                existing_by_track,
                background_tasks,
                match="by_track",
            )
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
    if existing:
        existing = _restart_retryable_failed_job(
            existing,
            background_tasks,
            match="by_source",
        )
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
    create_job(
        DB_PATH,
        job_id,
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


def _should_attempt_auto_repair(job) -> bool:
    if job.status in {"downloading", "queued", "processing"}:
        return False
    if job.status == "failed":
        return False
    result_path = resolve_analysis_path(STORAGE_ROOT, job.id)
    if not result_path.exists():
        return True
    if not job.source_id:
        return False
    return audio_path_for(STORAGE_ROOT, job.id) is None


def _attempt_auto_repair(job, background_tasks: BackgroundTasks):
    if job.status in {"downloading", "queued", "processing"}:
        return job

    audio_path = audio_path_for(STORAGE_ROOT, job.id)
    analysis_path = resolve_analysis_path(STORAGE_ROOT, job.id)
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
        source_url = _source_url_for_job(job)
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

    result_path = resolve_analysis_path(STORAGE_ROOT, job.id)
    if not result_path.exists():
        payload = JobError(
            status="failed",
            error=normalize_job_error(ANALYSIS_MISSING_MESSAGE),
            error_code=error_code_for(ANALYSIS_MISSING_MESSAGE),
            **base_payload,
        )
        return JSONResponse(payload.model_dump(), status_code=200)

    data = read_analysis_json(result_path)
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


@router.get("/api/analysis/{job_id}", responses=error_responses(404))
def get_analysis(job_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    return _response_with_auto_repair(job, background_tasks)


@router.post("/api/jobs/{job_id}/retry", responses=error_responses(404))
def retry_job_by_id(job_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    job = _restart_retryable_failed_job(
        job,
        background_tasks,
        match="by_job_id",
    )
    return _response_with_auto_repair(job, background_tasks)


@router.post("/api/analysis/youtube", responses=error_responses(400, 422))
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


@router.post("/api/analysis/url", responses=error_responses(400, 403, 422, 500))
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
    preflight_provider, preflight_source_id = _source_identity_from_url(normalized_url)
    existing = _find_existing_source_job(preflight_provider, preflight_source_id, normalized_url)
    if existing and should_recycle_job(existing):
        recycle_job(existing)
        existing = None
    if existing:
        existing = _restart_retryable_failed_job(
            existing,
            background_tasks,
            match="by_url_preflight",
        )
        log_event(
            "job_reused",
            job_id=existing.id,
            source=existing.source_provider or "unknown",
            match="by_url_preflight",
        )
        return _job_response(existing)
    try:
        source_info = resolve_source_info(normalized_url)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        detail = _resolution_failure_detail(exc)
        if detail["message"] != ERROR_GENERIC:
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_resolution_failure_detail(exc)) from exc

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


@router.post("/api/upload", responses=error_responses(400, 403, 413, 422, 500))
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
    create_job(
        DB_PATH,
        job_id,
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


@router.post("/api/plays/{job_id}", responses=error_responses(404))
def increment_play_count(job_id: str) -> JSONResponse:
    play_count = increment_job_plays(DB_PATH, job_id)
    if play_count is None:
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    payload = PlayCountResponse(id=job_id, play_count=play_count)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.patch("/api/plays/{job_id}", responses=error_responses(403, 404))
def set_play_count(
    job_id: str,
    payload: PlayCountUpdate,
    admin_key: str | None = Header(None, alias=ADMIN_KEY_HEADER),
) -> JSONResponse:
    require_admin_key(admin_key)
    play_count = set_job_play_count(DB_PATH, job_id, payload.play_count)
    if play_count is None:
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
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


@router.get(
    "/api/jobs/by-source/{source_provider}/{source_id:path}",
    responses=error_responses(400, 404),
)
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
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    if should_recycle_job(job):
        recycle_job(job)
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    if _is_retryable_failed_job(job):
        job = _restart_retryable_failed_job(
            job,
            background_tasks,
            match="by_source_lookup",
        )
    return _response_with_auto_repair(job, background_tasks)


@router.get("/api/jobs/by-track", responses=error_responses(404))
def get_job_by_track_match(
    background_tasks: BackgroundTasks,
    title: str = Query(..., min_length=1),
    artist: str = Query(..., min_length=1),
) -> JSONResponse:
    log_event("spotify_selection", title=title, artist=artist)
    job = get_job_by_track(DB_PATH, title, artist)
    if not job:
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    if should_recycle_job(job):
        recycle_job(job)
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)
    if _is_retryable_failed_job(job):
        job = _restart_retryable_failed_job(
            job,
            background_tasks,
            match="by_track_lookup",
        )
    log_event(
        "job_reused",
        job_id=job.id,
        source=job.source_provider or "unknown",
        match="by_track_lookup",
    )
    return _response_with_auto_repair(job, background_tasks)


@router.delete("/api/jobs/{job_id}", responses=error_responses(403, 404))
def delete_job_by_id(
    job_id: str,
    admin_key: str | None = Header(None, alias=ADMIN_KEY_HEADER),
) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=JOB_NOT_FOUND_DETAIL)

    is_admin_delete = admin_key_matches(admin_key)
    if not is_admin_delete:
        created_at = parse_timestamp(job.created_at)
        completion_time = None
        if job.status == "complete":
            result_path = resolve_analysis_path(STORAGE_ROOT, job.id)
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

    delete_job_artifacts(job_id)
    delete_job(DB_PATH, job_id)
    log_event(
        "job_deleted",
        job_id=job_id,
        source=job.source_provider or "unknown",
        delete_mode="admin" if is_admin_delete else "window",
    )
    return JSONResponse({"status": "deleted", "id": job_id}, status_code=200)
