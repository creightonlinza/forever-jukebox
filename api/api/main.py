"""REST API for analysis requests."""

from __future__ import annotations

import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from starlette.responses import Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from .db import init_db
from .favorites_db import init_favorites_db
from .http_client import close_client
from .paths import DB_PATH, FAVORITES_DB_PATH, STORAGE_ROOT, WEB_DIST

load_dotenv()

from .routes.config import router as config_router
from .routes.favorites import router as favorites_router
from .routes.jobs import router as jobs_router
from .routes.media import router as media_router
from .routes.search import router as search_router

app = FastAPI(title="The Forever Jukebox Analysis API")
app.include_router(config_router)
app.include_router(favorites_router)
app.include_router(jobs_router)
app.include_router(media_router)
app.include_router(search_router)

WP_GARBAGE_RE = re.compile(
    r"^/(wp-|wp/|wordpress/|blog/|cms/|site/|wp-includes/|wp-admin/|wp-content/|xmlrpc\.php|.*wlwmanifest\.xml)",
    re.IGNORECASE,
)


@app.middleware("http")
async def block_garbage_paths(request: Request, call_next):
    if WP_GARBAGE_RE.match(request.url.path):
        return Response(status_code=410)
    return await call_next(request)


@app.on_event("startup")
def _startup() -> None:
    init_db(DB_PATH)
    init_favorites_db(FAVORITES_DB_PATH)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "audio").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "analysis").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "logs").mkdir(parents=True, exist_ok=True)


@app.on_event("shutdown")
def _shutdown() -> None:
    close_client()


if WEB_DIST.exists():
    assets_dir = WEB_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        if full_path == "cast" or full_path.startswith("cast/"):
            cast_entry = WEB_DIST / "cast-receiver.html"
            if cast_entry.exists():
                return FileResponse(cast_entry)
        if full_path == "offline":
            return RedirectResponse(url="/offline/", status_code=308)
        if full_path.startswith("offline/"):
            offline_dist = WEB_DIST / "offline"
            offline_index = offline_dist / "index.html"
            if offline_index.exists():
                if full_path == "offline/":
                    return FileResponse(offline_index)
                offline_candidate = (WEB_DIST / full_path).resolve()
                if offline_candidate.is_file() and offline_candidate.is_relative_to(offline_dist):
                    return FileResponse(offline_candidate)
                return FileResponse(offline_index)
        candidate = (WEB_DIST / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(WEB_DIST):
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
