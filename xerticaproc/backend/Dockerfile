# syntax=docker/dockerfile:1.6
# ── Stage 1: build deps ──────────────────────────────────────────────────────
# Build context: xerticaproc/  (one level above backend/)
FROM python:3.12-slim AS builder

WORKDIR /build

# system libs needed by asyncpg / reportlab
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install -r requirements.txt

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# copy the entire xerticaproc package so absolute imports work
COPY . /app/xerticaproc/

# non-root user
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8080
ENV PORT=8080
ENV PYTHONPATH=/app

CMD ["sh", "-c", "uvicorn xerticaproc.backend.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
