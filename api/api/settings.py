"""API settings loaded from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ApiSettings:
    spotify_client_id: str | None
    spotify_client_secret: str | None
    youtube_api_key: str | None
    search_limit: int
    youtube_search_limit: int
    http_timeout_s: float


def load_settings() -> ApiSettings:
    return ApiSettings(
        spotify_client_id=os.environ.get("SPOTIFY_CLIENT_ID"),
        spotify_client_secret=os.environ.get("SPOTIFY_CLIENT_SECRET"),
        youtube_api_key=os.environ.get("YOUTUBE_API_KEY"),
        search_limit=_env_int("SEARCH_LIMIT", 10),
        youtube_search_limit=_env_int("YOUTUBE_SEARCH_LIMIT", 10),
        http_timeout_s=_env_float("HTTP_TIMEOUT_S", 10.0),
    )


def _env_int(key: str, default: int) -> int:
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_float(key: str, default: float) -> float:
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default
