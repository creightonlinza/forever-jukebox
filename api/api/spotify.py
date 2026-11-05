"""Spotify API helpers with token caching."""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass

import httpx

from .http_client import get_client
from .settings import ApiSettings


SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"


@dataclass
class SpotifyTokenCache:
    token: str | None = None
    expires_at: float = 0.0


_token_cache = SpotifyTokenCache()


def _get_credentials(settings: ApiSettings) -> tuple[str, str]:
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        raise RuntimeError("Spotify credentials missing")
    return settings.spotify_client_id, settings.spotify_client_secret


def _fetch_token(settings: ApiSettings) -> tuple[str, float]:
    client_id, client_secret = _get_credentials(settings)
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("utf-8")
    headers = {"Authorization": f"Basic {auth}"}
    data = {"grant_type": "client_credentials"}
    response = get_client().post(SPOTIFY_TOKEN_URL, data=data, headers=headers)
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    expires_in = payload.get("expires_in", 3600)
    if not token:
        raise RuntimeError("Spotify token missing")
    return token, time.time() + max(0, int(expires_in) - 30)


def _get_token(settings: ApiSettings, force_refresh: bool = False) -> str:
    if not force_refresh and _token_cache.token and time.time() < _token_cache.expires_at:
        return _token_cache.token
    token, expires_at = _fetch_token(settings)
    _token_cache.token = token
    _token_cache.expires_at = expires_at
    return token


def _search_request(query: str, token: str, limit: int) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"}
    params = {"q": query, "type": "track", "limit": limit}
    return get_client().get(SPOTIFY_SEARCH_URL, params=params, headers=headers)


def _retry_with_backoff(
    settings: ApiSettings, query: str, limit: int, attempts: int = 3
) -> httpx.Response:
    delay = 0.5
    response: httpx.Response | None = None
    for attempt in range(attempts):
        token = _get_token(settings, force_refresh=False)
        response = _search_request(query, token, limit)
        if response.status_code not in (400, 401):
            return response
        try:
            payload = response.json()
            error = payload.get("error", {})
            message = error.get("message", "")
        except Exception:
            message = response.text
        if response.status_code == 400 and "Only valid bearer authentication supported" not in message:
            return response
        _get_token(settings, force_refresh=True)
        if attempt < attempts - 1:
            time.sleep(delay)
            delay *= 2
    if response is None:
        raise RuntimeError("Spotify search failed")
    return response


def _album_thumbnail(track: dict) -> str | None:
    # Spotify lists album art largest first; the smallest (about 64 px) suits a result row.
    images = [image for image in (track.get("album") or {}).get("images") or [] if image.get("url")]
    return images[-1]["url"] if images else None


def search_spotify_tracks(query: str, settings: ApiSettings, limit: int) -> list[dict[str, object]]:
    response = _retry_with_backoff(settings, query, limit)
    if response.status_code != 200:
        raise RuntimeError(response.text)
    payload = response.json()
    items = []
    for track in payload.get("tracks", {}).get("items", []):
        artist_list = track.get("artists") or []
        artist = artist_list[0].get("name") if artist_list else None
        duration_ms = track.get("duration_ms")
        if duration_ms is None:
            continue
        items.append(
            {
                "id": track.get("id"),
                "name": track.get("name"),
                "artist": artist,
                "duration": round(duration_ms / 1000),
                "image": _album_thumbnail(track),
            }
        )
    return items
