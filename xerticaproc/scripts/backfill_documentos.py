"""Backfill da tabela `documentos` a partir dos anexos já existentes em `mensagens`.

Itera todas as mensagens com `anexos != []`. Para cada anexo único (gcs_uri),
baixa do GCS, calcula SHA256 e insere em `documentos` (origem=upload_chat,
status=processando) — depois chama `process_documento` em paralelo limitado.

Também cria as linhas em `mensagem_documento_refs` para preservar a relação
chat ↔ documento.

Idempotente: pula documentos cujo (contratacao_id, sha256) já existe.

Uso:
    cd /workspaces/lici-adk
    python -m xerticaproc.scripts.backfill_documentos --contratacao <id>
    python -m xerticaproc.scripts.backfill_documentos --all
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import sys
from typing import Any

from sqlalchemy import text

from xerticaproc.backend.models.copilot_schemas import (
    DocumentoOrigem,
    DocumentoStatus,
)
from xerticaproc.backend.tools import documentos_pipeline as dp
from xerticaproc.backend.tools import documentos_store as ds
from xerticaproc.backend.tools.pg_tools import get_session

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("backfill_documentos")


async def _list_contratacoes_with_anexos() -> list[str]:
    async with get_session() as s:
        rows = (await s.execute(
            text("""
                SELECT DISTINCT contratacao_id
                  FROM mensagens
                 WHERE jsonb_array_length(COALESCE(anexos, '[]'::jsonb)) > 0
            """),
        )).fetchall()
    return [str(r.contratacao_id) for r in rows]


async def _list_anexos_for(contratacao_id: str) -> list[dict[str, Any]]:
    """Retorna lista achatada de {mensagem_id, anexo} para a contratação."""
    async with get_session() as s:
        rows = (await s.execute(
            text("""
                SELECT id AS mensagem_id, anexos
                  FROM mensagens
                 WHERE contratacao_id = :cid
                   AND jsonb_array_length(COALESCE(anexos, '[]'::jsonb)) > 0
                 ORDER BY criado_em ASC
            """),
            {"cid": contratacao_id},
        )).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        for a in (r.anexos or []):
            if isinstance(a, dict) and a.get("gcs_uri"):
                out.append({"mensagem_id": str(r.mensagem_id), "anexo": a})
    return out


async def _process_one(contratacao_id: str, mensagem_id: str, anexo: dict[str, Any]) -> str | None:
    nome = anexo.get("nome") or "anexo"
    mime = anexo.get("mime") or "application/octet-stream"
    gcs_uri = anexo.get("gcs_uri")
    if not gcs_uri:
        return None

    # baixa para sha256
    try:
        data = await dp.gcs_download(gcs_uri)
    except Exception as e:  # pragma: no cover
        log.warning("download falhou %s: %s", gcs_uri, e)
        return None
    sha = hashlib.sha256(data).hexdigest()

    async with get_session() as s:
        existing = await ds.find_by_sha(s, contratacao_id=contratacao_id, sha256=sha)
        if existing:
            doc_id = existing.id
            await ds.link_message_documento(
                s,
                mensagem_id=mensagem_id,
                documento_id=doc_id,
                papel="anexado_pelo_usuario",
            )
            await s.commit()
            log.info("dedup hit %s sha=%s", nome, sha[:8])
            return doc_id

        doc_id = await ds.insert_documento(
            s,
            contratacao_id=contratacao_id,
            nome=nome,
            mime=mime,
            bytes_size=len(data),
            sha256=sha,
            storage_uri=gcs_uri,
            origem=DocumentoOrigem.UPLOAD_CHAT,
            origem_ref={"backfill": True, "mensagem_id": mensagem_id},
            status=DocumentoStatus.PROCESSANDO,
        )
        await ds.link_message_documento(
            s,
            mensagem_id=mensagem_id,
            documento_id=doc_id,
            papel="anexado_pelo_usuario",
        )
        await s.commit()
        log.info("inserido %s id=%s", nome, doc_id)

    # processa (extract + thumb)
    try:
        await dp.process_documento(contratacao_id=contratacao_id, documento_id=doc_id)
    except Exception as e:  # pragma: no cover
        log.warning("process_documento falhou doc=%s: %s", doc_id, e)
    return doc_id


async def _run(contratacoes: list[str], parallel: int = 4) -> None:
    sem = asyncio.Semaphore(parallel)
    total = 0
    for cid in contratacoes:
        items = await _list_anexos_for(cid)
        log.info("contratação %s — %d anexos", cid, len(items))

        async def _bound(item: dict[str, Any]) -> None:
            async with sem:
                await _process_one(cid, item["mensagem_id"], item["anexo"])

        await asyncio.gather(*[_bound(it) for it in items])
        total += len(items)
    log.info("backfill concluído: %d anexos processados", total)


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--contratacao", help="UUID da contratação")
    g.add_argument("--all", action="store_true", help="todas as contratações com anexos")
    ap.add_argument("--parallel", type=int, default=4)
    args = ap.parse_args()

    if args.all:
        cids = asyncio.run(_list_contratacoes_with_anexos())
    else:
        cids = [args.contratacao]

    if not cids:
        log.info("nada a fazer")
        return

    asyncio.run(_run(cids, parallel=args.parallel))


if __name__ == "__main__":
    sys.exit(main())
