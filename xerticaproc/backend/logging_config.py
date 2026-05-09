"""Configuração de logging estruturado — xerticaproc.

Emite JSON Lines compatível com Cloud Logging (severity, jsonPayload).
Aceita campos extras via `logger.info("msg", extra={"contratacao_id": cid, ...})`.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}

_LEVEL_TO_SEVERITY = {
    "CRITICAL": "CRITICAL", "ERROR": "ERROR", "WARNING": "WARNING",
    "INFO": "INFO", "DEBUG": "DEBUG",
}


class StructuredFormatter(logging.Formatter):
    """Formato JSON compatível com Cloud Logging."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": time.strftime(
                "%Y-%m-%dT%H:%M:%S", time.gmtime(record.created),
            ) + f".{int(record.msecs):03d}Z",
            "severity": _LEVEL_TO_SEVERITY.get(record.levelname, record.levelname),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for k, v in record.__dict__.items():
            if k in _RESERVED or k.startswith("_"):
                continue
            try:
                json.dumps(v, default=str)
                payload[k] = v
            except Exception:
                payload[k] = str(v)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers[:] = [handler]


def log_event(
    logger: logging.Logger, *,
    event: str, contratacao_id: str | None = None,
    level: int = logging.INFO, **fields: Any,
) -> None:
    """Helper para eventos de domínio (auditoria)."""
    extra: dict[str, Any] = {"event": event}
    if contratacao_id:
        extra["contratacao_id"] = contratacao_id
    extra.update(fields)
    logger.log(level, event, extra=extra)
