"""API response models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, StrictBool
from typing import Literal


class JobBase(BaseModel):
    id: str
    youtube_id: str | None = None
    created_at: str | None = None
    is_user_supplied: bool | None = None


class JobProgress(JobBase):
    status: Literal["queued", "downloading", "processing"]
    progress: int | None = None
    message: str | None = None


class JobError(JobBase):
    status: Literal["failed"]
    error: str | None = None
    error_code: str | None = None


class JobComplete(JobBase):
    status: Literal["complete"]
    result: dict[str, object]
    progress: int | None = None


class SearchItem(BaseModel):
    id: str
    title: str
    duration: int


class SearchResponse(BaseModel):
    items: list[SearchItem]


class SpotifyItem(BaseModel):
    id: str | None = None
    name: str | None = None
    artist: str | None = None
    duration: int


class SpotifySearchResponse(BaseModel):
    items: list[SpotifyItem]


class TopSongItem(BaseModel):
    id: str | None = None
    youtube_id: str | None = None
    title: str | None = None
    artist: str | None = None
    play_count: int | None = None


class TopSongsResponse(BaseModel):
    items: list[TopSongItem]


class RecentSongsResponse(BaseModel):
    items: list[TopSongItem]


class PlayCountResponse(BaseModel):
    id: str
    play_count: int


class PlayCountUpdate(BaseModel):
    play_count: int


class AnalysisStartResponse(BaseModel):
    id: str
    status: Literal["queued", "downloading"]
    progress: int | None = None
    message: str | None = None


class AnalysisYoutubeRequest(BaseModel):
    youtube_id: str = Field(min_length=1)
    title: str | None = None
    artist: str | None = None
    is_user_supplied: StrictBool = False


class AppConfigResponse(BaseModel):
    allow_user_upload: bool
    allow_user_youtube: bool
    allow_favorites_sync: bool = False
    max_upload_size: int | None = None
    allowed_upload_exts: list[str] | None = None
    max_track_length: float | None = None


class FavoriteTrack(BaseModel):
    uniqueSongId: str
    title: str
    artist: str
    duration: float | None = None
    sourceType: str | None = None

    model_config = ConfigDict(extra="allow")


class FavoritesSyncRequest(BaseModel):
    favorites: list[FavoriteTrack]


class FavoritesSyncResponse(BaseModel):
    code: str
    count: int
    favorites: list[FavoriteTrack] | None = None


class FavoritesSyncPayload(BaseModel):
    favorites: list[FavoriteTrack]
