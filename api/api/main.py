"""REST API for analysis requests."""

from __future__ import annotations

import functools
import logging
import re
from xml.sax.saxutils import escape

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from starlette.responses import Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from .db import get_job, get_job_by_source, init_db
from .favorites_db import init_favorites_db
from .http_client import close_client
from .paths import DB_PATH, FAVORITES_DB_PATH, STORAGE_ROOT, WEB_DIST
from .route_responses import NOT_FOUND

load_dotenv()

logger = logging.getLogger(__name__)

from .routes.config import router as config_router
from .routes.admin import router as admin_router
from .routes.favorites import router as favorites_router
from .routes.jobs import router as jobs_router
from .routes.media import router as media_router
from .routes.search import router as search_router

app = FastAPI(title="The Forever Jukebox Analysis API")
app.include_router(admin_router)
app.include_router(config_router)
app.include_router(favorites_router)
app.include_router(jobs_router)
app.include_router(media_router)
app.include_router(search_router)

WP_GARBAGE_RE = re.compile(
    r"^/(wp-|wp/|wordpress/|blog/|cms/|site/|wp-includes/|wp-admin/|wp-content/|xmlrpc\.php|.*wlwmanifest\.xml)",
    re.IGNORECASE,
)

# Public, indexable pages as (path, changefreq, priority). "/faq" and "/whats-new"
# share a tab but render distinct content with distinct titles, so both are listed.
# Excludes the redirect-only bare "/listen" route; per-track "/listen/{id}" pages are
# dynamic and intentionally kept out of the index via a noindex meta tag instead.
SITEMAP_PATHS = (
    ("/", "daily", "1.0"),
    ("/search", "weekly", "0.8"),
    ("/faq", "monthly", "0.5"),
    ("/whats-new", "weekly", "0.5"),
    ("/offline/", "monthly", "0.5"),
)

# Per-track "/listen/{id}" pages are served (so already-crawled URLs resolve), but kept
# out of search indexes via this tag; "follow" still lets crawlers traverse their links.
NOINDEX_META = '<meta name="robots" content="noindex, follow" />'

# Open Graph / Twitter Card defaults. og:url and og:image must be absolute, so they are
# injected server-side from the request host rather than hardcoded in the static HTML —
# this keeps the app hoster-agnostic (same rationale as the sitemap/robots routes).
SITE_NAME = "The Forever Jukebox"
SITE_AUTHOR = "Creighton Linza"
SITE_DESCRIPTION = (
    "The Forever Jukebox turns any song into a never-ending version of itself — "
    "seamlessly jumping between similar beats to remix it on the fly."
)


def _attr(value: str) -> str:
    """Escape a string for use inside a double-quoted HTML attribute."""
    return escape(value, {'"': "&quot;"})


def _social_meta(
    base_url: str,
    page_url: str,
    *,
    title: str = SITE_NAME,
    description: str = SITE_DESCRIPTION,
    og_type: str = "website",
) -> str:
    """Build the absolute-URL Open Graph / Twitter Card tags for a page."""
    image = f"{base_url}/og-image.png"
    tags = (
        ("og:type", og_type, "property"),
        ("og:site_name", SITE_NAME, "property"),
        ("og:title", title, "property"),
        ("og:description", description, "property"),
        ("og:url", page_url, "property"),
        ("og:image", image, "property"),
        ("og:image:width", "1200", "property"),
        ("og:image:height", "630", "property"),
        ("twitter:card", "summary_large_image", "name"),
        ("twitter:title", title, "name"),
        ("twitter:description", description, "name"),
        ("twitter:image", image, "name"),
    )
    return "".join(
        f'<meta {kind}="{key}" content="{_attr(value)}" />' for key, value, kind in tags
    )


def _head_meta(
    base_url: str,
    page_url: str,
    *,
    noindex: bool,
    title: str = SITE_NAME,
    description: str = SITE_DESCRIPTION,
    og_type: str = "website",
) -> str:
    """Build the full SEO <head> block injected into served HTML pages."""
    parts = [
        f'<meta name="description" content="{_attr(description)}" />',
        f'<meta name="author" content="{_attr(SITE_AUTHOR)}" />',
        _social_meta(base_url, page_url, title=title, description=description, og_type=og_type),
    ]
    if noindex:
        parts.insert(0, NOINDEX_META)
    return "\n    ".join(parts)


# Track-id parsing mirrors the web app (identity.ts `isLikelyJobId` + track-load.ts
# `parseTrackId`): a 32-hex id is a job id; "provider:sourceId" names a known source;
# anything else is treated as a bare YouTube source id.
JOB_ID_RE = re.compile(r"^[a-f0-9]{32}$")
SOURCE_PREFIX_RE = re.compile(r"^([a-z]+):(.+)$")
SOURCE_PROVIDERS = frozenset({"youtube", "soundcloud", "bandcamp"})


def _parse_track_id(track_id: str) -> tuple[str, str, str | None]:
    """Return (kind, a, b): ("job", job_id, None) or ("source", provider, source_id)."""
    if JOB_ID_RE.match(track_id):
        return ("job", track_id, None)
    match = SOURCE_PREFIX_RE.match(track_id)
    if match and match.group(1) in SOURCE_PROVIDERS:
        return ("source", match.group(1), match.group(2))
    return ("source", "youtube", track_id)


def _track_card(title: str, artist: str | None) -> tuple[str, str]:
    """Build (og_title, description) text for a track's share card."""
    artist = (artist or "").strip() or None
    if artist:
        return f"{title} — {artist}", (
            f"Listen to {title} by {artist} as a never-ending remix on {SITE_NAME}."
        )
    return title, f"Listen to {title} as a never-ending remix on {SITE_NAME}."


def _listen_card(track_id: str) -> tuple[str, str] | None:
    """Look up a track and return its (og_title, description), or None if unknown.

    A DB read here is fast (WAL, indexed point lookup) but must never break page
    delivery — any failure degrades to the default card rather than 500-ing the page.
    """
    kind, a, b = _parse_track_id(track_id)
    try:
        job = get_job(DB_PATH, a) if kind == "job" else get_job_by_source(DB_PATH, a, b)
    except Exception:
        logger.warning("listen OG lookup failed for %r", track_id, exc_info=True)
        return None
    title = (job.track_title or "").strip() if job else ""
    if not title:
        return None
    return _track_card(title, job.track_artist)


def _inject_head(html: str, snippet: str) -> str:
    """Insert an HTML snippet just before the document's closing </head> tag."""
    if "</head>" in html:
        return html.replace("</head>", f"    {snippet}\n  </head>", 1)
    return snippet + html


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


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml(request: Request):
    base_url = str(request.base_url).rstrip("/")
    entries = "".join(
        "<url>"
        f"<loc>{escape(base_url if path == '/' else f'{base_url}{path}')}</loc>"
        f"<changefreq>{changefreq}</changefreq>"
        f"<priority>{priority}</priority>"
        "</url>"
        for path, changefreq, priority in SITEMAP_PATHS
    )
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{entries}"
        "</urlset>"
    )
    return Response(content=content, media_type="application/xml")


@app.get("/robots.txt", include_in_schema=False)
def robots_txt(request: Request):
    base_url = str(request.base_url).rstrip("/")
    content = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /cast\n"
        f"Sitemap: {base_url}/sitemap.xml\n"
    )
    return Response(content=content, media_type="text/plain; charset=utf-8")


if WEB_DIST.exists():
    assets_dir = WEB_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @functools.lru_cache(maxsize=1)
    def _index_template() -> str:
        return (WEB_DIST / "index.html").read_text(encoding="utf-8")

    def _render_index(base_url: str, full_path: str) -> str:
        page_url = base_url if not full_path else f"{base_url}/{full_path.lstrip('/')}"
        noindex = full_path == "listen" or full_path.startswith("listen/")
        extra = {}
        if full_path.startswith("listen/"):
            card = _listen_card(full_path[len("listen/") :])
            if card:
                extra = {"title": card[0], "description": card[1], "og_type": "music.song"}
        head = _head_meta(base_url, page_url, noindex=noindex, **extra)
        return _inject_head(_index_template(), head)

    @app.get("/{full_path:path}", responses=NOT_FOUND)
    def spa_fallback(full_path: str, request: Request):
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
        base_url = str(request.base_url).rstrip("/")
        return HTMLResponse(_render_index(base_url, full_path))
