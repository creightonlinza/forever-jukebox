"""Audio and log file routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..db import get_job
from ..paths import DB_PATH, STORAGE_ROOT
from ..route_responses import NOT_FOUND
from ..storage import get_store

router = APIRouter()


@router.get("/api/audio/{job_id}", responses=NOT_FOUND)
def get_audio(job_id: str):
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    response = get_store(STORAGE_ROOT).audio_response(job.id)
    if response is None:
        raise HTTPException(status_code=404, detail="Audio missing")
    return response


@router.get("/api/logs/{job_id}", responses=NOT_FOUND)
def get_job_log(job_id: str):
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    log_path = STORAGE_ROOT / "logs" / f"{job.id}.log"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    return FileResponse(path=str(log_path), media_type="text/plain")
