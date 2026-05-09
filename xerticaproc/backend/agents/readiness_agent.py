"""Readiness Agent — avalia se a contratação está pronta para gerar ETP/TR/Mapa.

Pure-function (sem LLM) — usa o catálogo do checklist_engine para decidir.
Score = (confirmados + 0.6*inferidos + dispensados) / total não-bloqueantes.
can_generate = não há bloqueantes pendentes (excluindo owner=orgao, que
viram placeholders no documento — G16).
"""
from __future__ import annotations

from typing import Iterable

from xerticaproc.backend.agents import checklist_engine as ce
from xerticaproc.backend.models.copilot_schemas import (
    ChecklistCriticidade,
    ChecklistItem,
    ChecklistOwner,
    ChecklistResponse,
    ChecklistStatus,
    DocumentReadiness,
    MissingItem,
)

PREENCHIDOS = {
    ChecklistStatus.CONFIRMADO,
    ChecklistStatus.INFERIDO,
    ChecklistStatus.DISPENSADO,
}


def _to_missing(it: ChecklistItem) -> MissingItem:
    return MissingItem(
        item_key=it.item_key,
        label=it.label,
        criticidade=it.criticidade,
        owner=it.owner,
    )


def _flatten(checklist: ChecklistResponse) -> list[ChecklistItem]:
    out: list[ChecklistItem] = []
    for items in checklist.by_category.values():
        out.extend(items)
    return out


def _recommendations(
    blocking: list[MissingItem],
    optional: list[MissingItem],
    open_orgao: list[MissingItem],
    doc_type: str,
) -> str:
    lines: list[str] = []
    if blocking:
        lines.append(f"Para gerar o {doc_type.upper()} faltam {len(blocking)} item(ns) bloqueante(s):")
        for m in blocking[:5]:
            lines.append(f"  - {m.label} ({m.item_key})")
        if len(blocking) > 5:
            lines.append(f"  - ... e mais {len(blocking) - 5}")
    else:
        lines.append(f"Pronto para gerar o {doc_type.upper()}.")
        if optional:
            lines.append(
                f"{len(optional)} item(ns) não-bloqueante(s) ainda pendente(s) "
                "podem reduzir a qualidade do documento."
            )
        if open_orgao:
            lines.append(
                f"{len(open_orgao)} campo(s) institucional(is) (responsabilidade do órgão) "
                "ficarão como placeholders no documento."
            )
    return "\n".join(lines)


def evaluate(
    checklist: ChecklistResponse, doc_type: str,
) -> DocumentReadiness:
    if doc_type not in ce.REQUIRED_BLOCKING_FOR:
        raise ValueError(
            f"doc_type inválido: {doc_type!r} (use etp, tr ou mapa_precos)"
        )

    items = _flatten(checklist)
    by_key: dict[str, ChecklistItem] = {it.item_key: it for it in items}
    required_keys = ce.REQUIRED_BLOCKING_FOR[doc_type]

    blocking_missing: list[MissingItem] = [
        _to_missing(by_key[k])
        for k in required_keys
        if k in by_key and by_key[k].status not in PREENCHIDOS
    ]

    optional_missing: list[MissingItem] = [
        _to_missing(it)
        for it in items
        if it.criticidade != ChecklistCriticidade.BLOQUEANTE
        and it.owner != ChecklistOwner.ORGAO
        and it.status == ChecklistStatus.PENDENTE
    ]

    inferred_items: list[MissingItem] = [
        _to_missing(it) for it in items if it.status == ChecklistStatus.INFERIDO
    ]

    open_fields_for_orgao: list[MissingItem] = [
        _to_missing(it)
        for it in items
        if it.owner == ChecklistOwner.ORGAO
        and it.status not in PREENCHIDOS
    ]

    # Score sobre todos os itens NÃO de owner=orgao (esses não contam — G16)
    scored = [it for it in items if it.owner != ChecklistOwner.ORGAO]
    if not scored:
        score = 0.0
    else:
        pts = 0.0
        for it in scored:
            if it.status == ChecklistStatus.CONFIRMADO:
                pts += 1.0
            elif it.status == ChecklistStatus.INFERIDO:
                pts += 0.6
            elif it.status == ChecklistStatus.DISPENSADO:
                pts += 1.0
        score = round(pts / len(scored), 3)

    can_generate = len(blocking_missing) == 0

    return DocumentReadiness(
        doc_type=doc_type,  # type: ignore[arg-type]
        can_generate=can_generate,
        score=score,
        blocking_missing=blocking_missing,
        optional_missing=optional_missing,
        inferred_items=inferred_items,
        open_fields_for_orgao=open_fields_for_orgao,
        recommendations=_recommendations(
            blocking_missing, optional_missing, open_fields_for_orgao, doc_type,
        ),
    )
