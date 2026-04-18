"""Agente 2 — Qualificador.

Para cada keyword extraída pelo Extrator, roda as 5 queries de `bigquery_tools` e
agrega tudo em `QualificadorResult`. Deduplica por id/chave natural.

Refs: ARCHITECTURE.md §Agente 2 — Qualificador.
"""
from __future__ import annotations

import logging
import time

from backend.models.schemas import EditalEstruturado, QualificadorResult
from backend.tools.bigquery_tools import (
    buscar_atestados,
    buscar_certificacoes,
    buscar_contratos_com_atestado,
    buscar_contratos_sem_atestado,
    buscar_deals_lost,
    buscar_deals_won,
)

log = logging.getLogger("lici_adk.qualificador")

MAX_KEYWORDS = 8


def qualificar(edital: EditalEstruturado) -> QualificadorResult:
    """Agrega evidências do BigQuery a partir das keywords do Extrator."""
    modo = "strict" if edital.strict_match_atestados else "like"
    agg = QualificadorResult(modo_busca=modo)

    seen_a, seen_c, seen_d, seen_ct = set(), set(), set(), set()
    t0 = time.time()

    keywords = (edital.keywords_busca or [])[:MAX_KEYWORDS]
    for kw in keywords:
        try:
            for a in buscar_atestados(
                kw,
                mode=modo,
                restricao_temporal_meses=edital.restricao_temporal_experiencia_meses,
                limit=20,
            ):
                if a.id and a.id not in seen_a:
                    agg.atestados.append(a)
                    seen_a.add(a.id)

            for c in buscar_contratos_com_atestado(kw, limit=20):
                key = ("c+a", c.nomedaconta, c.numerodocontrato)
                if key not in seen_c:
                    agg.contratos_com_atestado.append(c)
                    seen_c.add(key)

            for c in buscar_contratos_sem_atestado(kw, limit=20):
                key = ("c-a", c.nomedaconta, c.numerodocontrato)
                if key not in seen_c:
                    agg.contratos_sem_atestado.append(c)
                    seen_c.add(key)

            for d in buscar_deals_won(kw, limit=10):
                key = ("won", d.conta, d.oportunidade)
                if key not in seen_d:
                    agg.deals_won.append(d)
                    seen_d.add(key)

            for d in buscar_deals_lost(kw, limit=5):
                key = ("lost", d.conta, d.oportunidade)
                if key not in seen_d:
                    agg.deals_lost.append(d)
                    seen_d.add(key)

            for ct in buscar_certificacoes(kw, limit=30):
                if ct.cert_id and ct.cert_id not in seen_ct:
                    agg.certificados.append(ct)
                    seen_ct.add(ct.cert_id)

            agg.queries_executadas += 5
        except Exception:
            log.exception("qualificador.keyword_failed", extra={"keyword": kw})
            # tolera falha numa keyword — o Analista trabalha com o que veio.

    latency_ms = int((time.time() - t0) * 1000)
    log.info(
        "qualificador.done",
        extra={
            "lici_adk": {
                "agent": "qualificador",
                "modo_busca": modo,
                "latency_ms": latency_ms,
                "queries": agg.queries_executadas,
                "atestados": len(agg.atestados),
                "contratos_com_atestado": len(agg.contratos_com_atestado),
                "contratos_sem_atestado": len(agg.contratos_sem_atestado),
                "deals_won": len(agg.deals_won),
                "deals_lost": len(agg.deals_lost),
                "certificados": len(agg.certificados),
            }
        },
    )
    return agg
