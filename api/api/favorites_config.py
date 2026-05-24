"""Favorites configuration loaded from environment."""

from __future__ import annotations

from .env import env_positive_int

DEFAULT_MAX_FAVORITES = 150


def max_favorites() -> int:
    return env_positive_int("MAX_FAVORITES", DEFAULT_MAX_FAVORITES)
