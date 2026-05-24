"""Config endpoint."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..env import env_flag, env_positive_float, env_string
from ..models import AppConfigResponse
from .jobs_runtime import ALLOWED_UPLOAD_EXTS, MAX_UPLOAD_BYTES

router = APIRouter()


@router.get("/api/app-config")
def get_app_config() -> JSONResponse:
    allow_user_upload = env_flag("ALLOW_USER_UPLOAD")
    allow_user_url = env_flag("ALLOW_USER_URL")
    max_upload_size = MAX_UPLOAD_BYTES if allow_user_upload else None
    allowed_upload_exts = sorted(ALLOWED_UPLOAD_EXTS) if allow_user_upload else None
    payload = AppConfigResponse(
        allow_user_upload=allow_user_upload,
        allow_user_url=allow_user_url,
        allow_favorites_sync=env_flag("ALLOW_FAVORITES_SYNC"),
        max_upload_size=max_upload_size,
        allowed_upload_exts=allowed_upload_exts,
        max_track_length=env_positive_float("MAX_TRACK_LENGTH"),
        hosted_by_name=env_string("HOSTED_BY_NAME"),
        hosted_by_url=env_string("HOSTED_BY_URL"),
    )
    return JSONResponse(payload.model_dump(), status_code=200)
