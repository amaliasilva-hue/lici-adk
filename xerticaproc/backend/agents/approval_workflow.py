"""Workflow de aprovação multinível.

Define níveis hierárquicos exigidos por tipo de documento e calcula status
agregado a partir da lista de aprovações registradas.

Regras (configuráveis via env APPROVAL_LEVELS_JSON):
  ETP:           [Gestor, Demanda]
  TR:            [Gestor, Jurídico]
  Mapa de preços: [Gestor]

Status agregado:
  - pendente:   nenhum nível alcançado
  - parcial:    pelo menos um nível aprovado
  - aprovado:   todos os níveis aprovados
  - rejeitado:  qualquer nível com decisao=rejeitado
  - retorno:    qualquer nível com decisao=retorno (sem rejeição)
"""
from __future__ import annotations

import json
import os
from typing import Iterable, Literal

from xerticaproc.backend.models.copilot_schemas import Aprovacao

WorkflowStatus = Literal["pendente", "parcial", "aprovado", "rejeitado", "retorno"]

_DEFAULT_LEVELS: dict[str, list[str]] = {
    "etp": ["Gestor", "Demanda"],
    "tr": ["Gestor", "Jurídico"],
    "mapa_precos": ["Gestor"],
}


def _load_levels() -> dict[str, list[str]]:
    raw = os.environ.get("APPROVAL_LEVELS_JSON")
    if not raw:
        return _DEFAULT_LEVELS
    try:
        data = json.loads(raw)
        return {k: list(v) for k, v in data.items()}
    except Exception:
        return _DEFAULT_LEVELS


def required_levels(doc_type: str) -> list[str]:
    return _load_levels().get(doc_type, ["Gestor"])


def evaluate_workflow(
    doc_type: str, aprovacoes: Iterable[Aprovacao],
) -> dict:
    """Retorna {status, niveis: [{papel, decisao, por}], faltantes: [...]}."""
    needed = required_levels(doc_type)
    aps = list(aprovacoes)
    by_papel: dict[str, Aprovacao] = {}
    for a in aps:
        # Última decisão por papel prevalece (lista vem ordenada desc)
        if a.papel not in by_papel:
            by_papel[a.papel] = a

    if any(a.decisao == "rejeitado" for a in by_papel.values()):
        status: WorkflowStatus = "rejeitado"
    elif any(a.decisao == "retorno" for a in by_papel.values()):
        status = "retorno"
    else:
        approved_levels = [
            p for p in needed
            if p in by_papel and by_papel[p].decisao == "aprovado"
        ]
        if len(approved_levels) == len(needed):
            status = "aprovado"
        elif approved_levels:
            status = "parcial"
        else:
            status = "pendente"

    return {
        "status": status,
        "doc_type": doc_type,
        "niveis_requeridos": needed,
        "niveis": [
            {
                "papel": p,
                "decisao": by_papel[p].decisao if p in by_papel else None,
                "por": by_papel[p].aprovado_por if p in by_papel else None,
            }
            for p in needed
        ],
        "faltantes": [
            p for p in needed
            if p not in by_papel or by_papel[p].decisao != "aprovado"
        ],
    }
