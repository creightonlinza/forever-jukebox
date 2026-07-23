"""Shared API utilities."""

from __future__ import annotations

import logging
from pathlib import Path


LOGGER_NAME = "foreverjukebox.api"


def get_logger(name: str = LOGGER_NAME) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter("[%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def abs_storage_path(storage_root: Path, path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        if path.exists():
            return path
        audio_candidate = storage_root / "audio" / path.name
        if audio_candidate.exists():
            return audio_candidate
        analysis_candidate = storage_root / "analysis" / path.name
        if analysis_candidate.exists():
            return analysis_candidate
        return path
    return (storage_root / path).resolve()


def analysis_path_for(storage_root: Path, job_id: str) -> Path:
    """Deterministic analysis result path: analysis/<id>.json."""
    return storage_root / "analysis" / f"{job_id}.json"


# yt-dlp writes transient files alongside the final audio while downloading:
# partial files (audio/<id>.<ext>.part, .ytdl) and DASH fragments
# (audio/<id>.f251.<ext>). All start with "<id>." so a naive glob can match
# them mid-download; the finished audio is always exactly "<id>.<ext>" with a
# single extension component.
_AUDIO_TEMP_SUFFIXES = {".part", ".ytdl", ".tmp", ".temp"}


def audio_path_for(storage_root: Path, job_id: str) -> Path | None:
    """Resolve the finished audio file for a job by globbing audio/<id>.*.

    The job id is a unique UUID, so at most one final audio file exists. The
    extension varies (yt-dlp's chosen container, or the upload's own suffix),
    so it cannot be derived without touching the filesystem. Transient
    download artifacts are skipped. Returns None when no finished audio file is
    present.
    """
    for candidate in sorted((storage_root / "audio").glob(f"{job_id}.*")):
        # Reject anything that is not exactly "<id>.<ext>" (fragments, .part).
        if candidate.name != f"{job_id}{candidate.suffix}":
            continue
        if candidate.suffix.lower() in _AUDIO_TEMP_SUFFIXES:
            continue
        return candidate
    return None
