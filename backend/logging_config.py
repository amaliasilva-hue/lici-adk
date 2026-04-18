"""Logging estruturado JSON (schema `lici_adk`) — alimenta Cloud Logging → BigQuery → Dashboard.

Usa um JsonFormatter mínimo (sem dependência externa) para compatibilidade com Cloud Run.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "severity": record.levelname,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Campos custom passados via `extra={"lici_adk": {...}}` ou outros
        for key in ("lici_adk", "trace_id", "session_id", "user_email", "canal"):
            value = record.__dict__.get(key)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    # Silencia ruído de libs verbosas
    for noisy in ("google.auth", "urllib3", "google.api_core"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
