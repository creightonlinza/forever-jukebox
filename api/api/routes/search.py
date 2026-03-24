"""Search routes for Spotify and YouTube."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
import httpx

from ..http_client import get_client
from ..models import SearchResponse, SpotifyItem, SpotifySearchResponse
from ..settings import load_settings
from ..spotify import search_spotify_tracks
from ..youtube import search_youtube_api, search_youtube_ytdlp

router = APIRouter()
settings = load_settings()
MAX_SEARCH_QUERY_CHARS = 100


def _normalize_search_query(raw: str) -> str:
    cleaned = "".join(ch for ch in raw if ch.isprintable())
    cleaned = " ".join(cleaned.split()).strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="q is required")
    return cleaned[:MAX_SEARCH_QUERY_CHARS]


@router.get("/api/search/youtube")
def search_youtube(
    q: str = Query(..., min_length=1),
    target_duration: float | None = Query(None, ge=0),
) -> JSONResponse:
    query = _normalize_search_query(q)
    try:
        items = search_youtube_ytdlp(query, settings.youtube_search_limit, target_duration)
        payload = SearchResponse(items=items)
        return JSONResponse(payload.model_dump(), status_code=200)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        api_key = settings.youtube_api_key
        if not api_key:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            items = search_youtube_api(
                get_client(), api_key, query, settings.youtube_search_limit, target_duration
            )
        except httpx.HTTPError as api_exc:
            raise HTTPException(status_code=502, detail=str(api_exc)) from api_exc
        payload = SearchResponse(items=items)
        return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/search/spotify")
def search_spotify(q: str = Query(..., min_length=1)) -> JSONResponse:
    query = _normalize_search_query(q)
    try:
        items = search_spotify_tracks(query, settings, settings.search_limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    payload = SpotifySearchResponse(items=[SpotifyItem(**item) for item in items])
    return JSONResponse(payload.model_dump(), status_code=200)
