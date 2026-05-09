"""Revisor Agent — Sprint D (heurístico, sem LLM).

Avalia consistência cruzada entre documentos gerados e o estado da
contratação. Retorna lista de findings classificados por severidade.

Heurísticas (subset do doc 02 §5):
- F1: ETP existe, TR também — versão do TR ≥ versão do ETP
- F2: ETP cita "PENDENTE" em campo de owner ≠ órgão (era pra estar preenchido)
- F3: Mapa de preços com dispersão > 30% sem registro de descarte
- F4: TR cita "modelo de execução" mas tec.modelo_suporte está PENDENTE
- F5: Bloqueante de checklist em status PENDENTE
- F6: Decisões com fonte=sistema sem fato correlato (G18)
- F7: Pesquisa negativa registrada mas sem fontes_consultadas
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from xerticaproc.backend.models.copilot_schemas import (
    ChecklistResponse,
    ChecklistStatus,
    DocumentoGeradoLite,
    FonteUsuario,
    PesquisaNegativa,
)

Severidade = Literal["info", "warn", "error"]


class RevisorFinding(BaseModel):
    code: str
    severity: Severidade
    title: str
    detail: str
    refs: list[str] = Field(default_factory=list)


class RevisorReport(BaseModel):
    contratacao_id: str
    avaliado_em: datetime = Field(default_factory=datetime.utcnow)
    findings: list[RevisorFinding] = Field(default_factory=list)
    summary: dict[str, int] = Field(default_factory=dict)


_RE_PENDENTE = re.compile(r"\[PENDENTE\b[^\]]*\]")


def review(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    documentos: list[DocumentoGeradoLite],
    fontes: list[FonteUsuario],
    decisions: list[dict[str, Any]],
    facts: list[dict[str, Any]],
    negativas: list[PesquisaNegativa],
) -> RevisorReport:
    findings: list[RevisorFinding] = []

    by_type: dict[str, list[DocumentoGeradoLite]] = {}
    for d in documentos:
        by_type.setdefault(d.doc_type, []).append(d)

    etp_latest = sorted(by_type.get("etp", []), key=lambda d: d.versao)[-1:] if by_type.get("etp") else []
    tr_latest = sorted(by_type.get("tr", []), key=lambda d: d.versao)[-1:] if by_type.get("tr") else []

    # F1: TR sem ETP
    if tr_latest and not etp_latest:
        findings.append(RevisorFinding(
            code="F1", severity="error",
            title="TR gerado sem ETP correspondente",
            detail="Recomendação: gerar e aprovar ETP antes de emitir o TR.",
        ))

    # F2: PENDENTE em campos não-órgão dentro do ETP
    if etp_latest:
        etp = etp_latest[0]
        pendentes = _RE_PENDENTE.findall(etp.content_md)
        # Filtra os que mencionam "responsabilidade do órgão" — esses são esperados
        nao_esperados = [p for p in pendentes if "responsabilidade do órgão" not in p]
        if nao_esperados:
            findings.append(RevisorFinding(
                code="F2", severity="warn",
                title=f"ETP v{etp.versao} contém {len(nao_esperados)} placeholder(s) inesperado(s)",
                detail="Placeholders em campos que não são responsabilidade do órgão indicam dados ausentes no checklist.",
                refs=nao_esperados[:5],
            ))

    # F3: dispersão alta sem descarte
    valores = [f.valor_mensal_unitario for f in fontes if f.valor_mensal_unitario]
    if len(valores) >= 3:
        disp = (max(valores) - min(valores)) / max(valores) if max(valores) else 0
        descartadas = sum(1 for f in fontes if f.status.value == "descartada")
        if disp > 0.30 and descartadas == 0:
            findings.append(RevisorFinding(
                code="F3", severity="warn",
                title=f"Dispersão de preços {disp * 100:.1f}% sem descarte de outliers",
                detail="Recomenda-se revisar fontes extremas e justificar descarte ou manutenção.",
            ))

    # F4: TR com modelo de execução PENDENTE
    if tr_latest:
        tr = tr_latest[0]
        if "PENDENTE" in tr.content_md and "modelo" in tr.content_md.lower():
            by_key = {it.item_key: it for items in checklist.by_category.values() for it in items}
            ms = by_key.get("tec.modelo_suporte")
            if ms and ms.status == ChecklistStatus.PENDENTE:
                findings.append(RevisorFinding(
                    code="F4", severity="error",
                    title="TR cita modelo de execução mas tec.modelo_suporte está PENDENTE",
                    detail="Confirmar o modelo de suporte/execução antes de finalizar o TR.",
                    refs=["tec.modelo_suporte"],
                ))

    # F5: bloqueantes pendentes
    bloqs = []
    for items in checklist.by_category.values():
        for it in items:
            if (
                it.criticidade.value == "bloqueante"
                and it.status == ChecklistStatus.PENDENTE
                and it.owner.value != "orgao"
            ):
                bloqs.append(it.item_key)
    if bloqs:
        findings.append(RevisorFinding(
            code="F5",
            severity="error" if any(d.doc_type in ("etp", "tr") for d in documentos) else "warn",
            title=f"{len(bloqs)} item(ns) bloqueante(s) pendente(s) no checklist",
            detail="Itens bloqueantes precisam ser confirmados ou dispensados.",
            refs=bloqs[:8],
        ))

    # F6: decisões "sistema" sem fato correlato
    fact_tipos = {f.get("tipo") for f in facts}
    sis_sem_fato = [
        d for d in decisions
        if d.get("fonte") == "sistema" and d.get("tipo") not in fact_tipos
    ]
    if sis_sem_fato:
        findings.append(RevisorFinding(
            code="F6", severity="info",
            title=f"{len(sis_sem_fato)} decisão(ões) sistema sem fato correlato (G18)",
            detail="Verifique se a inferência do sistema é coerente com a conversa.",
            refs=[d.get("tipo") for d in sis_sem_fato[:5] if d.get("tipo")],
        ))

    # F7: busca negativa sem fontes consultadas
    sem_fontes = [n.termo for n in negativas if not n.fontes_consultadas]
    if sem_fontes:
        findings.append(RevisorFinding(
            code="F7", severity="warn",
            title=f"{len(sem_fontes)} busca(s) negativa(s) sem fontes consultadas",
            detail="Cada busca negativa precisa documentar onde foi pesquisada.",
            refs=sem_fontes[:5],
        ))

    summary: dict[str, int] = {"info": 0, "warn": 0, "error": 0}
    for f in findings:
        summary[f.severity] += 1

    return RevisorReport(
        contratacao_id=contratacao_id,
        findings=findings,
        summary=summary,
    )
