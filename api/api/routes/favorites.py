"""Favorites sync routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..env import env_flag
from ..favorites_db import (
    create_unique_code,
    load_favorites,
    save_favorites,
    update_favorites,
)
from ..models import FavoritesSyncPayload, FavoritesSyncRequest, FavoritesSyncResponse
from ..paths import FAVORITES_DB_PATH
from ..utils import get_logger

router = APIRouter()
logger = get_logger()

MAX_FAVORITES = 100


def _ensure_sync_enabled() -> None:
    if not env_flag("ALLOW_FAVORITES_SYNC"):
        raise HTTPException(status_code=403, detail="Favorites sync disabled.")


@router.post("/api/favorites/sync", response_model=FavoritesSyncResponse)
def create_favorites_sync(payload: FavoritesSyncRequest) -> JSONResponse:
    _ensure_sync_enabled()
    favorites = [item.model_dump() for item in payload.favorites]
    if len(favorites) > MAX_FAVORITES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many favorites (max {MAX_FAVORITES}).",
        )
    try:
        code = create_unique_code(FAVORITES_DB_PATH)
        save_favorites(FAVORITES_DB_PATH, code, favorites)
    except RuntimeError as exc:
        logger.error("Failed to create favorites sync code: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create sync code.")
    response = FavoritesSyncResponse(
        code=code, count=len(favorites), favorites=payload.favorites
    )
    return JSONResponse(response.model_dump())


@router.get("/api/favorites/sync/{code}", response_model=FavoritesSyncPayload)
def get_favorites_sync(code: str) -> JSONResponse:
    _ensure_sync_enabled()
    normalized = code.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Sync code is required.")
    favorites = load_favorites(FAVORITES_DB_PATH, normalized)
    if favorites is None:
        raise HTTPException(status_code=404, detail="Sync code not found.")
    response = FavoritesSyncPayload(favorites=favorites)
    return JSONResponse(response.model_dump())


@router.put("/api/favorites/sync/{code}", response_model=FavoritesSyncResponse)
def update_favorites_sync(code: str, payload: FavoritesSyncRequest) -> JSONResponse:
    _ensure_sync_enabled()
    normalized = code.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Sync code is required.")
    favorites = [item.model_dump() for item in payload.favorites]
    if len(favorites) > MAX_FAVORITES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many favorites (max {MAX_FAVORITES}).",
        )
    updated = update_favorites(FAVORITES_DB_PATH, normalized, favorites)
    if not updated:
        raise HTTPException(status_code=404, detail="Sync code not found.")
    response = FavoritesSyncResponse(
        code=normalized, count=len(favorites), favorites=payload.favorites
    )
    return JSONResponse(response.model_dump())
