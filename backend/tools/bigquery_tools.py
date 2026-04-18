"""BigQuery tools do Qualificador — funções puras, reutilizáveis no notebook e no agente ADK.

Todas as queries rodam em `operaciones-br.sales_intelligence` e usam parâmetros
escalares (evita SQL injection quando a keyword vem do LLM).

Contrato de retorno:
  - Cada função devolve uma lista de `*Match` do módulo `backend.models.schemas`.
  - Nenhuma função levanta exceção por "zero resultado" — lista vazia é sinal válido
    para o Analista disparar a regra #10 (fallback sem alucinação).

Observação sobre JOINs: `tematestado` é NULL em 100% dos contratos
(ver ARCHITECTURE.md §Decisões de Arquitetura). O JOIN é feito por
`LOWER(TRIM(nomedaconta))`.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Iterable, Literal

from google.cloud import bigquery

from backend.models.schemas import (
    AtestadoMatch,
    CertificadoMatch,
    ContratoMatch,
    DealMatch,
)

# ─── Configuração ──────────────────────────────────────────────────────────
BQ_PROJECT = os.getenv("LICI_BQ_PROJECT", "operaciones-br")
BQ_DATASET = os.getenv("LICI_BQ_DATASET", "sales_intelligence")

T_ATESTADOS = f"`{BQ_PROJECT}.{BQ_DATASET}.atestados`"
T_CONTRATOS = f"`{BQ_PROJECT}.{BQ_DATASET}.contratos`"
T_WON = f"`{BQ_PROJECT}.{BQ_DATASET}.closed_deals_won`"
T_LOST = f"`{BQ_PROJECT}.{BQ_DATASET}.closed_deals_lost`"
T_CERTS = f"`{BQ_PROJECT}.{BQ_DATASET}.certificados_xertica`"

# Famílias aceitas no modo `match_familia` (ARCHITECTURE.md §Qualificador a.2).
# Mantém-se conservador: só famílias claramente "Google".
FAMILIAS_GOOGLE = ("GCP", "Google Workspace", "Serviços GCP", "MVPs IA", "GWS")


@lru_cache(maxsize=1)
def _client() -> bigquery.Client:
    """Client BigQuery cacheado por processo (ADC via Default Compute SA no Cloud Run)."""
    return bigquery.Client(project=BQ_PROJECT)


def _run(sql: str, params: list[bigquery.ScalarQueryParameter]) -> Iterable[bigquery.Row]:
    job = _client().query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=params),
    )
    return job.result()


SearchMode = Literal["like", "strict", "familia"]


# ════════════════════════════════════════════════════════════════════════
# 1. Atestados por palavra-chave
# ════════════════════════════════════════════════════════════════════════
def buscar_atestados(
    keyword: str,
    mode: SearchMode = "like",
    restricao_temporal_meses: int | None = None,
    limit: int = 50,
) -> list[AtestadoMatch]:
    """Busca atestados com 3 modos (ver ARCHITECTURE.md §Qualificador).

    - `like`: default, busca substring em texto livre (resumo, objeto, familia).
    - `strict`: REGEXP com word-boundary — não aceita similares
      (usar quando o edital proíbe atestados similares, ex: Celepar).
    - `familia`: casa pelo campo estruturado `familia` quando o edital pede
      "parceiro Google" sem nomear GCP.

    `restricao_temporal_meses` aplica `datadoatestado >= CURRENT_DATE - N meses`
    (Celepar exige 36).
    """
    params: list[bigquery.ScalarQueryParameter] = [
        bigquery.ScalarQueryParameter("kw", "STRING", keyword),
    ]

    if mode == "strict":
        where = (
            "REGEXP_CONTAINS(LOWER(resumodoatestado), CONCAT(r'\\b', LOWER(@kw), r'\\b')) "
            "OR REGEXP_CONTAINS(LOWER(objeto), CONCAT(r'\\b', LOWER(@kw), r'\\b'))"
        )
    elif mode == "familia":
        # keyword ignorada — casa por classificação
        where = "familia IN UNNEST(@familias)"
        params = [bigquery.ArrayQueryParameter("familias", "STRING", list(FAMILIAS_GOOGLE))]
    else:  # like
        where = (
            "LOWER(resumodoatestado) LIKE CONCAT('%', LOWER(@kw), '%') "
            "OR LOWER(objeto)          LIKE CONCAT('%', LOWER(@kw), '%') "
            "OR LOWER(familia)         LIKE CONCAT('%', LOWER(@kw), '%')"
        )

    temporal = ""
    if restricao_temporal_meses:
        params.append(
            bigquery.ScalarQueryParameter("meses", "INT64", restricao_temporal_meses)
        )
        # datadoatestado é STRING — SAFE.PARSE_DATE protege linhas mal formatadas
        temporal = (
            " AND SAFE.PARSE_DATE('%Y-%m-%d', datadoatestado) "
            ">= DATE_SUB(CURRENT_DATE(), INTERVAL @meses MONTH)"
        )

    params.append(bigquery.ScalarQueryParameter("lim", "INT64", limit))

    sql = f"""
      SELECT id, nomedaconta, objeto, resumodoatestado, familia, acelerador,
             horas, datadoatestado, linkdeacesso, nrodocontrato
      FROM {T_ATESTADOS}
      WHERE ({where}){temporal}
      LIMIT @lim
    """
    return [
        AtestadoMatch(**{**dict(row), "keyword_hit": keyword if mode != "familia" else "familia_google"})
        for row in _run(sql, params)
    ]


# ════════════════════════════════════════════════════════════════════════
# 2. Contratos + atestados via JOIN por nomedaconta
# ════════════════════════════════════════════════════════════════════════
def buscar_contratos_com_atestado(keyword: str, limit: int = 50) -> list[ContratoMatch]:
    """Contratos relevantes com atestado vinculado pela conta (comprovação direta)."""
    sql = f"""
      SELECT c.nomedaconta, c.objetodocontrato, c.resumodocontrato,
             c.detalhamentoservicos, c.aceleradores, c.statusdocontrato,
             c.valordocontrato, c.numerodocontrato,
             a.id AS atestado_id, a.linkdeacesso AS atestado_linkdeacesso
      FROM {T_CONTRATOS} c
      LEFT JOIN {T_ATESTADOS} a
        ON LOWER(TRIM(a.nomedaconta)) = LOWER(TRIM(c.nomedaconta))
      WHERE a.id IS NOT NULL
        AND (LOWER(c.objetodocontrato) LIKE CONCAT('%', LOWER(@kw), '%')
          OR LOWER(c.resumodocontrato) LIKE CONCAT('%', LOWER(@kw), '%'))
      LIMIT @lim
    """
    params = [
        bigquery.ScalarQueryParameter("kw", "STRING", keyword),
        bigquery.ScalarQueryParameter("lim", "INT64", limit),
    ]
    return [ContratoMatch(**dict(row), keyword_hit=keyword) for row in _run(sql, params)]


# ════════════════════════════════════════════════════════════════════════
# 3. Contratos SEM atestado — experiência comprovável não formalizada
# ════════════════════════════════════════════════════════════════════════
def buscar_contratos_sem_atestado(keyword: str, limit: int = 50) -> list[ContratoMatch]:
    sql = f"""
      SELECT c.nomedaconta, c.objetodocontrato, c.resumodocontrato,
             c.detalhamentoservicos, c.aceleradores, c.statusdocontrato,
             c.valordocontrato, c.numerodocontrato
      FROM {T_CONTRATOS} c
      LEFT JOIN {T_ATESTADOS} a
        ON LOWER(TRIM(a.nomedaconta)) = LOWER(TRIM(c.nomedaconta))
      WHERE a.id IS NULL
        AND (LOWER(c.objetodocontrato) LIKE CONCAT('%', LOWER(@kw), '%')
          OR LOWER(c.resumodocontrato) LIKE CONCAT('%', LOWER(@kw), '%'))
      LIMIT @lim
    """
    params = [
        bigquery.ScalarQueryParameter("kw", "STRING", keyword),
        bigquery.ScalarQueryParameter("lim", "INT64", limit),
    ]
    return [ContratoMatch(**dict(row), keyword_hit=keyword) for row in _run(sql, params)]


# ════════════════════════════════════════════════════════════════════════
# 4 & 6. Deals ganhos e perdidos — contexto e guard-rail
# ════════════════════════════════════════════════════════════════════════
def _mapear_deal(row: bigquery.Row) -> DealMatch:
    d = dict(row)
    return DealMatch(
        conta=d.get("Conta"),
        oportunidade=d.get("Oportunidade"),
        produtos=d.get("Produtos"),
        familia_produto=d.get("Familia_Produto"),
        resumo_analise=d.get("Resumo_Analise"),
        fatores_sucesso=d.get("Fatores_Sucesso"),
        causa_raiz=d.get("Causa_Raiz"),
        licoes_aprendidas=d.get("Licoes_Aprendidas"),
        vertical_ia=d.get("Vertical_IA"),
        gross=d.get("Gross"),
        data_fechamento=str(d["Data_Fechamento"]) if d.get("Data_Fechamento") else None,
    )


def buscar_deals_won(keyword: str, limit: int = 20) -> list[DealMatch]:
    sql = f"""
      SELECT Conta, Oportunidade, Produtos, Familia_Produto,
             Resumo_Analise, Fatores_Sucesso, Licoes_Aprendidas,
             Vertical_IA, Gross, Data_Fechamento
      FROM {T_WON}
      WHERE LOWER(Produtos)       LIKE CONCAT('%', LOWER(@kw), '%')
         OR LOWER(Resumo_Analise) LIKE CONCAT('%', LOWER(@kw), '%')
      ORDER BY Data_Fechamento DESC
      LIMIT @lim
    """
    params = [
        bigquery.ScalarQueryParameter("kw", "STRING", keyword),
        bigquery.ScalarQueryParameter("lim", "INT64", limit),
    ]
    return [_mapear_deal(r) for r in _run(sql, params)]


def buscar_deals_lost(keyword: str, limit: int = 10) -> list[DealMatch]:
    sql = f"""
      SELECT Conta, Oportunidade, Produtos, Familia_Produto,
             Resumo_Analise, Causa_Raiz, Licoes_Aprendidas,
             Motivo_Status_GTM, Vertical_IA, Gross, Data_Fechamento
      FROM {T_LOST}
      WHERE LOWER(Produtos)       LIKE CONCAT('%', LOWER(@kw), '%')
         OR LOWER(Resumo_Analise) LIKE CONCAT('%', LOWER(@kw), '%')
      ORDER BY Data_Fechamento DESC
      LIMIT @lim
    """
    params = [
        bigquery.ScalarQueryParameter("kw", "STRING", keyword),
        bigquery.ScalarQueryParameter("lim", "INT64", limit),
    ]
    return [_mapear_deal(r) for r in _run(sql, params)]


# ════════════════════════════════════════════════════════════════════════
# 5. Certificações válidas para o tema do edital
# ════════════════════════════════════════════════════════════════════════
def buscar_certificacoes(keyword: str, limit: int = 100) -> list[CertificadoMatch]:
    """Certificações válidas (`expiration_date >= hoje`) que casam com a keyword."""
    sql = f"""
      SELECT cert_id, certification, certification_subtype,
             full_name, email, expiration_date
      FROM {T_CERTS}
      WHERE expiration_date >= CURRENT_DATE()
        AND LOWER(certification) LIKE CONCAT('%', LOWER(@kw), '%')
      ORDER BY expiration_date DESC
      LIMIT @lim
    """
    params = [
        bigquery.ScalarQueryParameter("kw", "STRING", keyword),
        bigquery.ScalarQueryParameter("lim", "INT64", limit),
    ]
    rows = _run(sql, params)
    return [
        CertificadoMatch(
            **{
                **dict(r),
                "expiration_date": str(r["expiration_date"]) if r.get("expiration_date") else None,
            }
        )
        for r in rows
    ]


def contar_perfis_tecnicos(regex_perfis: str) -> dict[str, int]:
    """Modo (e) do Qualificador — cruza perfis hiper-especializados por regex.

    Ex.: `r'\\b(machine learning|ml engineer|data engineer|cloud architect|finops|security)\\b'`
    """
    sql = f"""
      SELECT certification, COUNT(*) AS profissionais_ativos
      FROM {T_CERTS}
      WHERE expiration_date >= CURRENT_DATE()
        AND REGEXP_CONTAINS(LOWER(certification), @rx)
      GROUP BY certification
      ORDER BY profissionais_ativos DESC
    """
    params = [bigquery.ScalarQueryParameter("rx", "STRING", regex_perfis)]
    return {r["certification"]: r["profissionais_ativos"] for r in _run(sql, params)}


# ════════════════════════════════════════════════════════════════════════
# Sanity check — chamado pelo notebook antes de confiar nas tools
# ════════════════════════════════════════════════════════════════════════
def sanity_check() -> dict:
    """Retorna contagens das 5 tabelas. Usar no notebook para validar ADC/permissões."""
    counts = {}
    for alias, fq in {
        "atestados": T_ATESTADOS,
        "contratos": T_CONTRATOS,
        "closed_deals_won": T_WON,
        "closed_deals_lost": T_LOST,
        "certificados_xertica": T_CERTS,
    }.items():
        row = next(_run(f"SELECT COUNT(*) AS n FROM {fq}", []))
        counts[alias] = row["n"]
    return counts
