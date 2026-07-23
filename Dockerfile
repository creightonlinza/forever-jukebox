# syntax=docker/dockerfile:1.6

FROM --platform=$BUILDPLATFORM node:20-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY pwa/package.json pwa/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages/ packages/
COPY web/ web/
COPY pwa/ pwa/
RUN npm run build --workspace=web && npm run build --workspace=pwa

# PO token provider server for yt-dlp; version must match the pinned
# bgutil-ytdlp-pot-provider plugin in api/requirements.txt.
# amd64 + Debian bookworm so the canvas native dep matches the runtime stage.
FROM --platform=linux/amd64 denoland/deno:debian AS bgutil-build
ARG BGUTIL_POT_VERSION=1.3.1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${BGUTIL_POT_VERSION}" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /bgutil
WORKDIR /bgutil/server
RUN deno install --allow-scripts=npm:canvas --frozen

# Force amd64 so pip can use Essentia's manylinux x86_64 wheel (no source builds)
FROM --platform=linux/amd64 python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    build-essential \
    gcc \
    g++ \
    gfortran \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first to improve Docker caching
COPY api/requirements.txt /app/api/requirements.txt
COPY engine/requirements.txt /app/engine/requirements.txt
COPY engine/scripts/install_madmom_beats_lite.py /app/engine/scripts/install_madmom_beats_lite.py

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip wheel "setuptools==81.0.0" \
    && /opt/venv/bin/pip install "numpy==2.2.3" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    # Critical: ensure Essentia is installed from a wheel (never source)
    && /opt/venv/bin/pip install --no-build-isolation --only-binary=essentia -r /app/engine/requirements.txt \
    && /opt/venv/bin/python /app/engine/scripts/install_madmom_beats_lite.py --python /opt/venv/bin/python \
    && if /opt/venv/bin/pip show madmom >/dev/null 2>&1; then /opt/venv/bin/pip uninstall -y madmom && /opt/venv/bin/python /app/engine/scripts/install_madmom_beats_lite.py --python /opt/venv/bin/python; fi

# Precompile the venv to bytecode. Recompiling FastAPI/pydantic/starlette/uvicorn
# from source on every boot is the bulk of the ~13s before uvicorn binds on a Fly
# resume-from-stopped; shipping .pyc lets cold starts load them instead. Explicit
# compileall is not gated by PYTHONDONTWRITEBYTECODE, and unchecked-hash lets the
# read-only runtime trust the .pyc without stat-ing the source on import.
# `|| true`: a stray third-party file that won't compile just goes un-cached
# (falling back to today's behavior) rather than failing the whole build.
RUN /opt/venv/bin/python -m compileall -q -j 0 \
      --invalidation-mode unchecked-hash /opt/venv/lib || true

RUN curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip" \
      -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip \
    && chmod +x /usr/local/bin/deno \
    && deno --version

# Server plus the Deno cache it was installed with, so startup needs no
# npm registry access (entrypoint sets DENO_DIR for the POT process)
COPY --from=bgutil-build /bgutil/server /app/bgutil-pot/server
COPY --from=bgutil-build /deno-dir /app/bgutil-pot/deno-dir

# Now copy the actual source
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=frontend-build /app/web/dist ./web/dist
COPY --from=frontend-build /app/pwa/dist ./web/dist/offline
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

# Same precompile for the application code so the API and worker load .pyc on boot.
RUN /opt/venv/bin/python -m compileall -q -j 0 \
      --invalidation-mode unchecked-hash /app/api

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    ENGINE_REPO="/app/engine"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
