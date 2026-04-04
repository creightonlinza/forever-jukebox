"""Environment parsing helpers shared across API modules."""

from __future__ import annotations

import os


TRUTHY_VALUES = {"1", "true", "yes", "on"}


def env_flag(env_key: str) -> bool:
    value = os.environ.get(env_key, "")
    return value.lower() in TRUTHY_VALUES


def env_positive_float(env_key: str) -> float | None:
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
