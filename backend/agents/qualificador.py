"""Agente 2 — Qualificador.

Para cada keyword extraída pelo Extrator, roda as 5 queries de `bigquery_tools` e
agrega tudo em `QualificadorResult`. Deduplica por id/chave natural.

Refs: ARCHITECTURE.md §Agente 2 — Qualificador.
"""
from __future__ import annotations

import logging
import time
from functools import lru_cache
from pathlib import Path

import yaml

from backend.models.schemas import AtestadoMatch, EditalEstruturado, QualificadorResult
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

_PROFILE_PATH = Path(__file__).resolve().parent.parent / "xertica_profile.yaml"


@lru_cache(maxsize=1)
def _heuristica_internacional() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Carrega termos do YAML uma vez. Retorna (incluir, excluir) lower-case."""
    try:
        full = yaml.safe_load(_PROFILE_PATH.read_text())
        h = full.get("heuristica_internacional", {}) or {}
        incluir = tuple(t.strip().lower() for t in (h.get("termos_internacionais") or []) if t)
        excluir = tuple(t.strip().lower() for t in (h.get("termos_excluir") or []) if t)
        return incluir, excluir
    except Exception:
        log.exception("qualificador.heuristica_load_failed")
        return (), ()


@lru_cache(maxsize=1)
def _taxas_cambio() -> dict[str, float]:
    """Carrega taxas BRL do YAML (fallback {} se ausente)."""
    try:
        full = yaml.safe_load(_PROFILE_PATH.read_text())
        cambio = (full.get("cambio") or {}).get("taxas_para_brl") or {}
        return {k.upper(): float(v) for k, v in cambio.items()}
    except Exception:
        log.exception("qualificador.cambio_load_failed")
        return {}


def _classificar_origem(a: AtestadoMatch) -> str:
    """Heurística: classifica atestado como 'nacional' ou 'internacional'.

    Procura termos do YAML em nomedaconta/objeto/resumodoatestado/familia.
    Se algum `termos_excluir` casar primeiro, força 'nacional'.
    """
    incluir, excluir = _heuristica_internacional()
    blob = " ".join(
        s.lower() for s in (a.nomedaconta, a.objeto, a.resumodoatestado, a.familia) if s
    )
    if not blob:
        return "nacional"
    for termo in excluir:
        if termo in blob:
            return "nacional"
    for termo in incluir:
        if termo in blob:
            return "internacional"
    return "nacional"


def _detectar_moeda(a: AtestadoMatch) -> str | None:
    """Heurística simples de moeda no texto (PEN/USD/COP)."""
    blob = " ".join(
        s.lower() for s in (a.nomedaconta, a.objeto, a.resumodoatestado) if s
    )
    if not blob:
        return None
    if "soles" in blob or "s/." in blob or "pen " in blob:
        return "PEN"
    if "u$s" in blob or "us$" in blob or " usd" in blob or "dólar" in blob or "dolar" in blob:
        return "USD"
    if "cop$" in blob or " cop " in blob or "peso colombiano" in blob:
        return "COP"
    return None


def _enriquecer_atestado(a: AtestadoMatch) -> AtestadoMatch:
    a.origem = _classificar_origem(a)  # type: ignore[assignment]
    if a.origem == "internacional":
        moeda = _detectar_moeda(a) or "USD"
        a.moeda_original = moeda
        taxas = _taxas_cambio()
        taxa = taxas.get(moeda)
        if taxa and a.horas:
            # Se `horas` for proxy de valor (raro), apenas registra taxa para auditoria.
            a.cambio_aplicado = taxa
    return a


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
                    agg.atestados.append(_enriquecer_atestado(a))
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
    agg.atestados_nacionais_count = sum(1 for a in agg.atestados if a.origem == "nacional")
    agg.atestados_internacionais_count = sum(1 for a in agg.atestados if a.origem == "internacional")
    log.info(
        "qualificador.done",
        extra={
            "lici_adk": {
                "agent": "qualificador",
                "modo_busca": modo,
                "latency_ms": latency_ms,
                "queries": agg.queries_executadas,
                "atestados": len(agg.atestados),
                "atestados_nacionais": agg.atestados_nacionais_count,
                "atestados_internacionais": agg.atestados_internacionais_count,
                "contratos_com_atestado": len(agg.contratos_com_atestado),
                "contratos_sem_atestado": len(agg.contratos_sem_atestado),
                "deals_won": len(agg.deals_won),
                "deals_lost": len(agg.deals_lost),
                "certificados": len(agg.certificados),
            }
        },
    )
    return agg
