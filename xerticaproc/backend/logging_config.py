"""Configuração de logging estruturado — xerticaproc."""
import logging
import os


def configure_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=level,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "msg": "%(message)s"}',
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
