"""Shared admin authentication helpers."""

from __future__ import annotations

import os

from fastapi import HTTPException


ADMIN_KEY_HEADER = "X-Admin-Key"


def admin_key_matches(provided_key: str | None) -> bool:
    expected_key = os.environ.get("ADMIN_KEY")
    return bool(expected_key and provided_key == expected_key)


def require_admin_key(provided_key: str | None) -> None:
    expected_key = os.environ.get("ADMIN_KEY")
    if not expected_key:
        raise HTTPException(status_code=403, detail="ADMIN_KEY is not configured")
    if not provided_key or provided_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid admin key")
