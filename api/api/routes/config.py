"""Config endpoint."""

from __future__ import annotations

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..models import AppConfigResponse
from .jobs import ALLOWED_UPLOAD_EXTS, MAX_UPLOAD_BYTES

router = APIRouter()


def _is_enabled(env_key: str) -> bool:
    value = os.environ.get(env_key, "")
    return value.lower() in {"1", "true", "yes", "on"}


def _positive_float(env_key: str) -> float | None:
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


@router.get("/api/app-config")
def get_app_config() -> JSONResponse:
    allow_user_upload = _is_enabled("ALLOW_USER_UPLOAD")
    max_upload_size = MAX_UPLOAD_BYTES if allow_user_upload else None
    allowed_upload_exts = sorted(ALLOWED_UPLOAD_EXTS) if allow_user_upload else None
    payload = AppConfigResponse(
        allow_user_upload=allow_user_upload,
        allow_user_youtube=_is_enabled("ALLOW_USER_YOUTUBE"),
        allow_favorites_sync=_is_enabled("ALLOW_FAVORITES_SYNC"),
        max_upload_size=max_upload_size,
        allowed_upload_exts=allowed_upload_exts,
        max_track_length=_positive_float("MAX_TRACK_LENGTH"),
    )
    return JSONResponse(payload.model_dump(), status_code=200)
