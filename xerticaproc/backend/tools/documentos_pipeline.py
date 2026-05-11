"""Pipeline de processamento da Biblioteca de Documentos.

Etapas:
 1. SHA256 + upload para GCS (com dedup)
 2. extract texto (reusa document_extractor)
 3. thumb da 1ª página (PDF via PyMuPDF; imagem direto)
 4. update DB com status=pronto

A etapa de embedding (RAG) é deixada como TODO — feita em sprint posterior.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import uuid
from typing import Any, Optional

from xerticaproc.backend.models.copilot_schemas import (
    Anexo,
    DocumentoOrigem,
    DocumentoStatus,
)
from xerticaproc.backend.tools import document_extractor as dx
from xerticaproc.backend.tools import documentos_store as ds
from xerticaproc.backend.tools.pg_tools import get_session

log = logging.getLogger(__name__)

UPLOADS_BUCKET = os.environ.get("COPILOT_UPLOADS_BUCKET", "")
THUMB_MAX_SIZE = (640, 880)


# ─── GCS helpers ────────────────────────────────────────────────────────────

def _gcs_upload_sync(bucket_name: str, key: str, data: bytes, mime: str) -> str:
    from google.cloud import storage  # type: ignore
    cli = storage.Client()
    bucket = cli.bucket(bucket_name)
    blob = bucket.blob(key)
    blob.upload_from_string(data, content_type=mime)
    return f"gs://{bucket_name}/{key}"


async def _gcs_upload(key: str, data: bytes, mime: str) -> str:
    if not UPLOADS_BUCKET:
        raise RuntimeError("COPILOT_UPLOADS_BUCKET não configurado")
    return await asyncio.to_thread(_gcs_upload_sync, UPLOADS_BUCKET, key, data, mime)


def _gcs_signed_url_sync(gcs_uri: str, ttl_seconds: int = 900) -> Optional[str]:
    """Gera URL assinada de leitura para o blob (TTL=15min)."""
    try:
        from datetime import timedelta
        from urllib.parse import urlparse
        from google.cloud import storage  # type: ignore
        parsed = urlparse(gcs_uri)
        cli = storage.Client()
        bucket = cli.bucket(parsed.netloc)
        blob = bucket.blob(parsed.path.lstrip("/"))
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=ttl_seconds),
            method="GET",
        )
    except Exception as e:  # noqa: BLE001
        log.warning("signed url falhou para %s: %s", gcs_uri, e)
        return None


async def gcs_signed_url(gcs_uri: str, ttl_seconds: int = 900) -> Optional[str]:
    return await asyncio.to_thread(_gcs_signed_url_sync, gcs_uri, ttl_seconds)


def _gcs_download_sync(gcs_uri: str) -> bytes:
    from urllib.parse import urlparse
    from google.cloud import storage  # type: ignore
    parsed = urlparse(gcs_uri)
    cli = storage.Client()
    return cli.bucket(parsed.netloc).blob(parsed.path.lstrip("/")).download_as_bytes()


async def gcs_download(gcs_uri: str) -> bytes:
    return await asyncio.to_thread(_gcs_download_sync, gcs_uri)


# ─── thumb ──────────────────────────────────────────────────────────────────

def _make_thumb_pdf(data: bytes) -> Optional[bytes]:
    try:
        import fitz  # PyMuPDF
    except Exception:
        return None
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        if doc.page_count == 0:
            return None
        page = doc.load_page(0)
        # ~1.5x DPI default
        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
        png = pix.tobytes("png")
        doc.close()
        return png
    except Exception:  # noqa: BLE001
        log.exception("thumb PDF falhou")
        return None


def _make_thumb_image(data: bytes, mime: str) -> Optional[bytes]:
    try:
        from PIL import Image  # type: ignore
    except Exception:
        return data  # devolve original como thumb
    try:
        im = Image.open(io.BytesIO(data))
        im.thumbnail(THUMB_MAX_SIZE)
        buf = io.BytesIO()
        fmt = "PNG" if mime in ("image/png", "image/webp", "image/gif") else "JPEG"
        im.save(buf, format=fmt)
        return buf.getvalue()
    except Exception:  # noqa: BLE001
        log.exception("thumb image falhou")
        return None


# ─── upload + dedup ─────────────────────────────────────────────────────────

async def ingest_upload(
    *,
    contratacao_id: str,
    raw: bytes,
    nome: str,
    mime: str,
    origem: DocumentoOrigem = DocumentoOrigem.UPLOAD_CHAT,
    origem_ref: Optional[dict[str, Any]] = None,
    uploaded_by: Optional[str] = None,
) -> tuple[str, bool]:
    """Persiste o documento na biblioteca. Retorna (documento_id, was_new).

    Se já existe documento com mesmo SHA256 nesta contratação, devolve o
    existente sem duplicar GCS.
    """
    sha = hashlib.sha256(raw).hexdigest()

    async with get_session() as s:
        existing = await ds.find_by_sha(s, contratacao_id=contratacao_id, sha256=sha)
        if existing is not None:
            return str(existing.id), False

    # nome saneado (sem path traversal)
    safe = (nome or "anexo").strip().replace("/", "_").replace("\\", "_")[:200]
    doc_uuid = str(uuid.uuid4())
    ext = ""
    if "." in safe:
        ext = "." + safe.rsplit(".", 1)[-1].lower()
    key = f"copilot/{contratacao_id}/{doc_uuid}/original{ext or ''}"
    storage_uri = await _gcs_upload(key, raw, mime)

    async with get_session() as s:
        doc_id = await ds.insert_documento(
            s,
            contratacao_id=contratacao_id,
            nome=safe,
            mime=mime,
            bytes_size=len(raw),
            sha256=sha,
            storage_uri=storage_uri,
            origem=origem,
            origem_ref=origem_ref or {},
            uploaded_by=uploaded_by,
        )

    return doc_id, True


async def process_documento(documento_id: str, contratacao_id: str) -> None:
    """Background task: extract + thumb + atualiza status."""
    try:
        async with get_session() as s:
            doc = await ds.get_by_id(
                s, contratacao_id=contratacao_id, documento_id=documento_id,
            )
        if doc is None:
            log.warning("processamento: documento %s não encontrado", documento_id)
            return

        # baixa do GCS
        try:
            raw = await gcs_download(doc.storage_uri)
        except Exception as e:  # noqa: BLE001
            log.exception("falha download GCS %s", doc.storage_uri)
            async with get_session() as s:
                await ds.update_processed(
                    s, documento_id=documento_id,
                    status=DocumentoStatus.FALHOU,
                    meta_patch={"erro": f"download falhou: {e}"},
                )
            return

        # extract via document_extractor (reusa)
        anexo = Anexo(tipo="arquivo", nome=doc.nome, gcs_uri=doc.storage_uri)
        try:
            extracted = await dx.process_anexos([anexo])
        except Exception:  # noqa: BLE001
            log.exception("extract falhou")
            extracted = []
        text_excerpt: Optional[str] = None
        pages: Optional[int] = None
        if extracted:
            ex = extracted[0]
            text_excerpt = (ex.text_excerpt or "")[:60000] or None
            pages = ex.pages or None

        # thumb
        thumb_uri: Optional[str] = None
        thumb_bytes: Optional[bytes] = None
        if doc.mime == "application/pdf":
            thumb_bytes = await asyncio.to_thread(_make_thumb_pdf, raw)
        elif doc.mime.startswith("image/"):
            thumb_bytes = await asyncio.to_thread(_make_thumb_image, raw, doc.mime)
        if thumb_bytes:
            try:
                thumb_key = f"copilot/{contratacao_id}/{documento_id}/thumb.png"
                thumb_uri = await _gcs_upload(thumb_key, thumb_bytes, "image/png")
            except Exception as e:  # noqa: BLE001
                log.warning("upload thumb falhou: %s", e)

        async with get_session() as s:
            await ds.update_processed(
                s,
                documento_id=documento_id,
                status=DocumentoStatus.PRONTO,
                pages=pages,
                text_excerpt=text_excerpt,
                thumb_uri=thumb_uri,
            )
    except Exception:  # noqa: BLE001
        log.exception("process_documento crashed for %s", documento_id)
        try:
            async with get_session() as s:
                await ds.update_processed(
                    s, documento_id=documento_id,
                    status=DocumentoStatus.FALHOU,
                    meta_patch={"erro": "exception no pipeline"},
                )
        except Exception:  # noqa: BLE001
            pass
