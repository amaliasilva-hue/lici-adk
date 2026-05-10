"""Checklist Engine — Lei 14.133/2021 + IN SGD/ME 94/2022.

Mantém o checklist vivo de uma contratação: ~32 itens em 9 categorias.
Veja docs/revamp/05_CHECKLIST_ENGINE.md para o catálogo canônico.
"""
from __future__ import annotations

import logging
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from xerticaproc.backend.models.copilot_schemas import (
    ChecklistCriticidade,
    ChecklistItem,
    ChecklistOwner,
    ChecklistResponse,
    ChecklistStatus,
    ChecklistSummary,
)

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Catálogo (seed)
# ─────────────────────────────────────────────────────────────────────────────

CHECKLIST_SEED: list[dict[str, str]] = [
    # demanda
    {"item_key": "demanda.problema_publico",     "categoria": "demanda",       "label": "Problema público que motiva a contratação", "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "demanda.objetivo",             "categoria": "demanda",       "label": "Objetivo específico e mensurável",          "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "demanda.unidade_demandante",   "categoria": "demanda",       "label": "Unidade demandante",                        "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "demanda.alinhamento_pca",      "categoria": "demanda",       "label": "Alinhamento com PCA/PDTIC",                  "criticidade": "alto",       "owner": "usuario"},
    # escopo
    {"item_key": "escopo.objeto_resumido",       "categoria": "escopo",        "label": "Descrição resumida do objeto",              "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "escopo.modalidade",            "categoria": "escopo",        "label": "Modalidade de contratação",                 "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "escopo.sistema_contratacao",   "categoria": "escopo",        "label": "Registro de Preços ou compra direta",       "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "escopo.lote",                  "categoria": "escopo",        "label": "Lote único ou múltiplos lotes",             "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "escopo.prazo_meses",           "categoria": "escopo",        "label": "Prazo referencial em meses",                "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "escopo.exclusoes",             "categoria": "escopo",        "label": "Itens explicitamente excluídos do escopo",  "criticidade": "medio",      "owner": "usuario"},
    # quantitativos
    {"item_key": "qtd.matriz_quantitativos",     "categoria": "quantitativos", "label": "Matriz de quantidades por item",            "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "qtd.justificativa_dimensionamento", "categoria": "quantitativos", "label": "Justificativa do dimensionamento",      "criticidade": "alto",       "owner": "usuario"},
    # precos
    {"item_key": "precos.fontes_diretas",        "categoria": "precos",        "label": "Pelo menos 1 fonte direta por item",        "criticidade": "bloqueante", "owner": "sistema"},
    {"item_key": "precos.memoria_calculo",       "categoria": "precos",        "label": "Memória de cálculo do preço de referência", "criticidade": "bloqueante", "owner": "sistema"},
    {"item_key": "precos.busca_negativa_registrada", "categoria": "precos",    "label": "Busca negativa registrada quando aplicável", "criticidade": "alto",       "owner": "sistema"},
    {"item_key": "precos.outliers_tratados",     "categoria": "precos",        "label": "Outliers identificados e tratados",         "criticidade": "medio",      "owner": "sistema"},
    # tecnico
    {"item_key": "tec.requisitos_funcionais",    "categoria": "tecnico",       "label": "Requisitos funcionais",                     "criticidade": "bloqueante", "owner": "usuario"},
    {"item_key": "tec.requisitos_nao_funcionais","categoria": "tecnico",       "label": "Requisitos não funcionais (SLA)",           "criticidade": "alto",       "owner": "usuario"},
    {"item_key": "tec.requisitos_seguranca",     "categoria": "tecnico",       "label": "Requisitos de segurança",                   "criticidade": "alto",       "owner": "usuario"},
    {"item_key": "tec.modelo_suporte",           "categoria": "tecnico",       "label": "Modelo de suporte",                         "criticidade": "medio",      "owner": "usuario"},
    # juridico
    {"item_key": "jur.aderencia_14133",          "categoria": "juridico",      "label": "Aderência à Lei 14.133/2021",               "criticidade": "bloqueante", "owner": "juridico"},
    {"item_key": "jur.aderencia_in94",           "categoria": "juridico",      "label": "Aderência à IN SGD/ME 94/2022",             "criticidade": "bloqueante", "owner": "juridico"},
    {"item_key": "jur.justificativa_marca",      "categoria": "juridico",      "label": "Justificativa de marca (se houver)",        "criticidade": "alto",       "owner": "juridico"},
    {"item_key": "jur.exclusividade_fundamento", "categoria": "juridico",      "label": "Fundamento de exclusividade",               "criticidade": "bloqueante", "owner": "juridico"},
    # lgpd
    {"item_key": "lgpd.tratamento_dados",        "categoria": "lgpd",          "label": "Tratamento de dados pessoais identificado", "criticidade": "alto",       "owner": "juridico"},
    {"item_key": "lgpd.base_legal",              "categoria": "lgpd",          "label": "Base legal LGPD identificada",              "criticidade": "alto",       "owner": "juridico"},
    # gestao (sempre owner=orgao → ficam abertos no documento)
    {"item_key": "gestao.processo",              "categoria": "gestao",        "label": "Número do processo administrativo",         "criticidade": "bloqueante", "owner": "orgao"},
    {"item_key": "gestao.dotacao_orcamentaria",  "categoria": "gestao",        "label": "Dotação orçamentária",                      "criticidade": "bloqueante", "owner": "orgao"},
    {"item_key": "gestao.gestor_contrato",       "categoria": "gestao",        "label": "Gestor do contrato indicado",               "criticidade": "bloqueante", "owner": "orgao"},
    {"item_key": "gestao.fiscal_contrato",       "categoria": "gestao",        "label": "Fiscal do contrato indicado",               "criticidade": "bloqueante", "owner": "orgao"},
    {"item_key": "gestao.autoridade_competente", "categoria": "gestao",        "label": "Autoridade competente para aprovação",      "criticidade": "bloqueante", "owner": "orgao"},
    # documentos
    {"item_key": "doc.dfd_anexado",              "categoria": "documentos",    "label": "DFD anexado ao processo",                   "criticidade": "medio",      "owner": "usuario"},
    {"item_key": "doc.matriz_riscos",            "categoria": "documentos",    "label": "Matriz de riscos elaborada",                "criticidade": "bloqueante", "owner": "sistema"},
    {"item_key": "doc.matriz_alternativas",      "categoria": "documentos",    "label": "Matriz de alternativas elaborada",          "criticidade": "bloqueante", "owner": "sistema"},
]

# Itens cujo owner é o órgão — nunca preenchidos pelo sistema
OPEN_FOR_ORGAO: list[str] = [
    it["item_key"] for it in CHECKLIST_SEED if it["owner"] == "orgao"
]

# Bloqueantes para gerar cada documento (excluindo os de owner=orgao,
# que viram placeholders no documento — G16)
_BLOCKING_NON_ORGAO = [
    it["item_key"] for it in CHECKLIST_SEED
    if it["criticidade"] == "bloqueante" and it["owner"] != "orgao"
]

REQUIRED_BLOCKING_FOR: dict[str, list[str]] = {
    "etp": _BLOCKING_NON_ORGAO,
    "tr":  _BLOCKING_NON_ORGAO + ["tec.modelo_suporte"],
    "mapa_precos": [
        "precos.fontes_diretas",
        "precos.memoria_calculo",
        "qtd.matriz_quantitativos",
    ],
}


def get_seed_item(item_key: str) -> Optional[dict[str, str]]:
    return next((it for it in CHECKLIST_SEED if it["item_key"] == item_key), None)


# ─────────────────────────────────────────────────────────────────────────────
# Persistência
# ─────────────────────────────────────────────────────────────────────────────

async def seed_checklist(session: AsyncSession, contratacao_id: str | UUID) -> int:
    """Insere os ~32 itens em status 'pendente'. Idempotente (ON CONFLICT DO NOTHING)."""
    cid = str(contratacao_id)
    for item in CHECKLIST_SEED:
        await session.execute(
            text("""
                INSERT INTO checklist_itens
                  (contratacao_id, item_key, categoria, label,
                   status, criticidade, owner)
                VALUES
                  (:cid, :item_key, :categoria, :label,
                         CAST('pendente' AS checklist_status),
                         CAST(:criticidade AS checklist_critic),
                         CAST(:owner AS checklist_owner))
                ON CONFLICT (contratacao_id, item_key) DO NOTHING
            """),
            {"cid": cid, **item},
        )
    return len(CHECKLIST_SEED)


async def list_items(
    session: AsyncSession, contratacao_id: str | UUID
) -> list[ChecklistItem]:
    rows = await session.execute(
        text("""
            SELECT item_key, categoria, label, status, criticidade, owner,
                   valor, evidence_ids, justificativa, atualizado_em
              FROM checklist_itens
             WHERE contratacao_id = :cid
             ORDER BY categoria, item_key
        """),
        {"cid": str(contratacao_id)},
    )
    return [
        ChecklistItem(
            item_key=r.item_key,
            categoria=r.categoria,
            label=r.label,
            status=ChecklistStatus(r.status),
            criticidade=ChecklistCriticidade(r.criticidade),
            owner=ChecklistOwner(r.owner),
            valor=r.valor,
            evidence_ids=r.evidence_ids or [],
            justificativa=r.justificativa,
            atualizado_em=r.atualizado_em,
        )
        for r in rows
    ]


async def update_item(
    session: AsyncSession,
    contratacao_id: str | UUID,
    item_key: str,
    *,
    status: ChecklistStatus,
    valor: Any | None = None,
    justificativa: str | None = None,
    evidence_ids: list[str] | None = None,
    allow_orgao_override: bool = False,
) -> Optional[ChecklistItem]:
    """Atualiza um item. Se owner=orgao e allow_orgao_override=False, ignora."""
    seed = get_seed_item(item_key)
    if seed is None:
        log.warning("checklist.update_item: item_key desconhecido %r", item_key)
        return None
    if seed["owner"] == "orgao" and not allow_orgao_override:
        log.info("checklist.update_item: skip %s (owner=orgao)", item_key)
        return None
    if status == ChecklistStatus.DISPENSADO and not justificativa:
        raise ValueError("Dispensar item exige justificativa.")

    import json
    await session.execute(
        text("""
            UPDATE checklist_itens
               SET status        = CAST(:status AS checklist_status),
                   valor         = CAST(:valor AS jsonb),
                   justificativa = COALESCE(:just, justificativa),
                   evidence_ids  = COALESCE(CAST(:ev AS jsonb), evidence_ids),
                   atualizado_em = NOW()
             WHERE contratacao_id = :cid
               AND item_key       = :item_key
        """),
        {
            "cid": str(contratacao_id),
            "item_key": item_key,
            "status": status.value,
            "valor": json.dumps(valor) if valor is not None else None,
            "just": justificativa,
            "ev": json.dumps(evidence_ids) if evidence_ids is not None else None,
        },
    )
    items = await list_items(session, contratacao_id)
    return next((it for it in items if it.item_key == item_key), None)


async def get_response(
    session: AsyncSession, contratacao_id: str | UUID
) -> ChecklistResponse:
    items = await list_items(session, contratacao_id)
    by_cat: dict[str, list[ChecklistItem]] = {}
    for it in items:
        by_cat.setdefault(it.categoria, []).append(it)
    summary = ChecklistSummary(
        total=len(items),
        confirmado=sum(1 for it in items if it.status == ChecklistStatus.CONFIRMADO),
        inferido=sum(1 for it in items if it.status == ChecklistStatus.INFERIDO),
        pendente=sum(1 for it in items if it.status == ChecklistStatus.PENDENTE),
        dispensado=sum(1 for it in items if it.status == ChecklistStatus.DISPENSADO),
        bloqueante_pendente=sum(
            1 for it in items
            if it.criticidade == ChecklistCriticidade.BLOQUEANTE
            and it.status == ChecklistStatus.PENDENTE
            and it.owner != ChecklistOwner.ORGAO
        ),
    )
    return ChecklistResponse(by_category=by_cat, summary=summary)
