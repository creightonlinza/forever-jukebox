"""Admin-only maintenance routes."""

from __future__ import annotations

from threading import Lock

from fastapi import APIRouter, Header, HTTPException

from ..admin_auth import ADMIN_KEY_HEADER, require_admin_key
from ..models import StorageCleanupRequest, StorageCleanupResponse
from ..paths import DB_PATH, STORAGE_ROOT
from ..storage_cleanup import build_cleanup_preview, execute_cleanup

router = APIRouter()
_storage_cleanup_lock = Lock()


@router.post("/api/admin/storage-cleanup")
def run_storage_cleanup(
    payload: StorageCleanupRequest,
    admin_key: str | None = Header(None, alias=ADMIN_KEY_HEADER),
) -> StorageCleanupResponse:
    require_admin_key(admin_key)
    if not _storage_cleanup_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Storage cleanup is already running")
    try:
        if payload.dry_run:
            return build_cleanup_preview(
                DB_PATH,
                STORAGE_ROOT,
            )
        if payload.confirm != "delete":
            raise HTTPException(status_code=400, detail='confirm must be "delete" when dry_run is false')
        return execute_cleanup(
            DB_PATH,
            STORAGE_ROOT,
        )
    finally:
        _storage_cleanup_lock.release()
