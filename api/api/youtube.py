"""YouTube search helpers."""

from __future__ import annotations

from typing import Any

import httpx

from .ytdlp_config import apply_ejs_config


YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"


def format_search_title(entry: dict[str, Any]) -> str:
    track = entry.get("track")
    artist = entry.get("artist") or entry.get("uploader")
    if track and artist:
        return f"{track} - {artist}"
    return entry.get("title") or "Unknown title"


def parse_iso8601_duration(value: str) -> int | None:
    if not value:
        return None
    hours = 0
    minutes = 0
    seconds = 0
    num = ""
    in_time = False
    for ch in value:
        if ch == "T":
            in_time = True
            num = ""
            continue
        if ch.isdigit():
            num += ch
            continue
        if not in_time or not num:
            num = ""
            continue
        if ch == "H":
            hours = int(num)
        elif ch == "M":
            minutes = int(num)
        elif ch == "S":
            seconds = int(num)
        num = ""
    return hours * 3600 + minutes * 60 + seconds


def search_youtube_api(
    client: httpx.Client,
    api_key: str,
    query: str,
    max_results: int,
    target_duration: float | None,
) -> list[dict[str, Any]]:
    params = {
        "part": "snippet",
        "q": query,
        "maxResults": max_results,
        "key": api_key,
        "type": "video",
        "regionCode": "US",
    }
    response = client.get(YOUTUBE_SEARCH_URL, params=params)
    response.raise_for_status()
    payload = response.json()
    items = payload.get("items") or []
    video_ids = []
    title_map: dict[str, str] = {}
    for item in items:
        vid = item.get("id", {}).get("videoId")
        if not vid:
            continue
        title = (item.get("snippet") or {}).get("title") or "Untitled"
        title_map[vid] = title
        video_ids.append(vid)
    if not video_ids:
        return []
    videos_params = {
        "part": "contentDetails,snippet",
        "id": ",".join(video_ids),
        "key": api_key,
    }
    videos_response = client.get(YOUTUBE_VIDEOS_URL, params=videos_params)
    videos_response.raise_for_status()
    videos_payload = videos_response.json()
    video_items = videos_payload.get("items") or []
    results = []
    for item in video_items:
        vid = item.get("id")
        if not vid:
            continue
        content_details = item.get("contentDetails") or {}
        duration = parse_iso8601_duration(content_details.get("duration", ""))
        if duration is None:
            continue
        title = (item.get("snippet") or {}).get("title") or title_map.get(vid) or "Untitled"
        results.append({"id": vid, "title": title, "duration": duration})
    if target_duration is not None:
        results.sort(key=lambda item: abs(item["duration"] - target_duration))
    return results


def search_youtube_ytdlp(
    query: str,
    max_results: int,
    target_duration: float | None,
) -> list[dict[str, Any]]:
    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError("yt-dlp is not available") from exc

    ydl_opts = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": True,
        "nocheckcertificate": True,
    }
    apply_ejs_config(ydl_opts)
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)

    entries = []
    if isinstance(info, dict):
        entries = info.get("entries") or []

    items = []
    for entry in entries:
        if not entry:
            continue
        entry_id = entry.get("id")
        if not entry_id:
            continue
        entry_duration = entry.get("duration")
        if entry_duration is None:
            continue
        items.append(
            {
                "id": entry_id,
                "title": format_search_title(entry),
                "duration": entry_duration,
            }
        )

    if target_duration is not None:
        items.sort(key=lambda item: abs(item["duration"] - target_duration))

    return items
