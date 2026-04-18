"""Agente 4 — Persistor.

Após o Analista produzir o `ParecerFinal`, persiste a análise em
`operaciones-br.lici_adk.analises_editais` para histórico consultável.

Não é um agente LLM — é uma tool de escrita BigQuery.
Cria a tabela automaticamente na primeira execução se não existir.

Refs: ARCHITECTURE.md §Agente 4 — Persistor.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from functools import lru_cache

from google.api_core.exceptions import NotFound
from google.cloud import bigquery

from backend.models.schemas import EditalEstruturado, ParecerFinal
from backend.tools.bigquery_tools import BQ_PROJECT  # usa mesma configuração de projeto

log = logging.getLogger("lici_adk.persistor")

# Dataset separado para análises — não polui o sales_intelligence
DEST_PROJECT = "operaciones-br"
DEST_DATASET = "lici_adk"
DEST_TABLE = "analises_editais"
FULL_TABLE = f"`{DEST_PROJECT}.{DEST_DATASET}.{DEST_TABLE}`"

TABLE_SCHEMA = [
    bigquery.SchemaField("analysis_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("trace_id", "STRING"),
    bigquery.SchemaField("data_analise", "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("orgao", "STRING"),
    bigquery.SchemaField("uf", "STRING"),
    bigquery.SchemaField("uasg", "STRING"),
    bigquery.SchemaField("modalidade", "STRING"),
    bigquery.SchemaField("objeto", "STRING"),
    bigquery.SchemaField("data_encerramento", "STRING"),
    bigquery.SchemaField("valor_estimado", "FLOAT64"),
    bigquery.SchemaField("duracao_contrato", "STRING"),
    bigquery.SchemaField("modelo_precificacao", "STRING"),    # JSON array serialized
    bigquery.SchemaField("exclusividade_me_epp", "BOOL"),
    bigquery.SchemaField("vedacao_consorcio", "BOOL"),
    bigquery.SchemaField("strict_match_atestados", "BOOL"),
    bigquery.SchemaField("restricao_temporal_meses", "INT64"),
    bigquery.SchemaField("keywords_busca", "STRING"),         # JSON array
    # Resultado do Analista
    bigquery.SchemaField("status", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("score_aderencia", "INT64"),
    bigquery.SchemaField("bloqueio_camada_1", "STRING"),
    bigquery.SchemaField("estrategia", "STRING"),
    bigquery.SchemaField("alertas_json", "STRING"),           # JSON array
    bigquery.SchemaField("gaps_json", "STRING"),              # JSON array
    bigquery.SchemaField("evidencias_count", "INT64"),
    bigquery.SchemaField("requisitos_atendidos_count", "INT64"),
    bigquery.SchemaField("campos_trello_json", "STRING"),
    # Metadados de performance
    bigquery.SchemaField("edital_filename", "STRING"),
    bigquery.SchemaField("pdf_hash_md5", "STRING"),
    bigquery.SchemaField("pipeline_ms", "INT64"),
]


@lru_cache(maxsize=1)
def _client() -> bigquery.Client:
    return bigquery.Client(project=DEST_PROJECT)


def _ensure_table() -> None:
    """Cria dataset + tabela se não existirem (idempotente)."""
    client = _client()
    dataset_ref = bigquery.DatasetReference(DEST_PROJECT, DEST_DATASET)
    try:
        client.get_dataset(dataset_ref)
    except NotFound:
        dataset = bigquery.Dataset(dataset_ref)
        dataset.location = "US"
        client.create_dataset(dataset, exists_ok=True)
        log.info("persistor.dataset_criado", extra={"dataset": DEST_DATASET})

    table_ref = dataset_ref.table(DEST_TABLE)
    try:
        client.get_table(table_ref)
    except NotFound:
        table = bigquery.Table(table_ref, schema=TABLE_SCHEMA)
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY,
            field="data_analise",
        )
        table.clustering_fields = ["status", "orgao", "uf"]
        client.create_table(table)
        log.info("persistor.tabela_criada", extra={"table": DEST_TABLE})


def persistir(
    parecer: ParecerFinal,
    edital: EditalEstruturado,
    *,
    edital_filename: str | None = None,
    pdf_bytes: bytes | None = None,
    pipeline_ms: int | None = None,
) -> bool:
    """Insere uma linha em `analises_editais`. Retorna True em sucesso.

    Falha silenciosa — não bloqueia a resposta da API se o BQ estiver down.
    """
    try:
        _ensure_table()
        t0 = time.time()

        row = {
            "analysis_id": parecer.trace_id or "unknown",
            "trace_id": parecer.trace_id,
            "data_analise": datetime.now(timezone.utc).isoformat(),
            "orgao": edital.orgao,
            "uf": edital.uf,
            "uasg": edital.uasg,
            "modalidade": edital.modalidade,
            "objeto": (edital.objeto or "")[:1000],
            "data_encerramento": edital.data_encerramento,
            "valor_estimado": edital.valor_estimado,
            "duracao_contrato": edital.duracao_contrato,
            "modelo_precificacao": json.dumps(edital.modelo_precificacao or [], ensure_ascii=False),
            "exclusividade_me_epp": edital.exclusividade_me_epp,
            "vedacao_consorcio": edital.vedacao_consorcio,
            "strict_match_atestados": edital.strict_match_atestados,
            "restricao_temporal_meses": edital.restricao_temporal_experiencia_meses,
            "keywords_busca": json.dumps(edital.keywords_busca or [], ensure_ascii=False),
            # Analista
            "status": parecer.status,
            "score_aderencia": parecer.score_aderencia,
            "bloqueio_camada_1": parecer.bloqueio_camada_1,
            "estrategia": parecer.estrategia,
            "alertas_json": json.dumps([a for a in parecer.alertas], ensure_ascii=False),
            "gaps_json": json.dumps(
                [g.model_dump() for g in parecer.gaps], ensure_ascii=False, default=str
            ),
            "evidencias_count": len(parecer.evidencias_por_requisito),
            "requisitos_atendidos_count": len(parecer.requisitos_atendidos),
            "campos_trello_json": json.dumps(parecer.campos_trello, ensure_ascii=False, default=str),
            # Metadados
            "edital_filename": edital_filename,
            "pdf_hash_md5": hashlib.md5(pdf_bytes).hexdigest() if pdf_bytes else None,
            "pipeline_ms": pipeline_ms,
        }

        errors = _client().insert_rows_json(
            f"{DEST_PROJECT}.{DEST_DATASET}.{DEST_TABLE}", [row]
        )
        insert_ms = int((time.time() - t0) * 1000)
        if errors:
            log.error("persistor.insert_errors", extra={"errors": errors})
            return False
        log.info(
            "persistor.ok",
            extra={
                "lici_adk": {
                    "agent": "persistor",
                    "analysis_id": parecer.trace_id,
                    "status": parecer.status,
                    "insert_ms": insert_ms,
                }
            },
        )
        return True
    except Exception:
        log.exception("persistor.failed", extra={"trace_id": parecer.trace_id})
        return False
