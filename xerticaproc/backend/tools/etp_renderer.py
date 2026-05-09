"""Renderer ETP — versão minimalista para Sprint C.

Gera um Markdown estruturado a partir de:
- ChecklistResponse (valores confirmados/inferidos)
- facts (dicts em estado in-memory)
- decisions (dicts em estado in-memory)
- fontes validadas (FonteUsuario)

Itens com owner=orgao ainda pendentes viram placeholders [PENDENTE — ...].
NÃO usa LLM — é puramente template-driven (rastreável, determinístico).
O agente Vertex (`agents/redator_agent.py`) continua disponível para versão
"premium"; este renderer é o caminho rápido para fechar o ciclo Sprint C.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Optional

from xerticaproc.backend.models.copilot_schemas import (
    ChecklistItem,
    ChecklistOwner,
    ChecklistResponse,
    ChecklistStatus,
    FonteUsuario,
    FonteUsuarioStatus,
)


def _val(item: ChecklistItem) -> Optional[str]:
    if item.valor is None:
        return None
    if isinstance(item.valor, (str, int, float)):
        return str(item.valor)
    return str(item.valor)


def _ph(item: ChecklistItem) -> str:
    return f"_[PENDENTE — {item.label} (responsabilidade do órgão)]_"


def _line(item: Optional[ChecklistItem], default: str = "") -> str:
    if item is None:
        return default
    if item.owner == ChecklistOwner.ORGAO and item.status not in {
        ChecklistStatus.CONFIRMADO, ChecklistStatus.INFERIDO,
    }:
        return _ph(item)
    v = _val(item)
    if v is None:
        if item.status == ChecklistStatus.DISPENSADO:
            return f"_Dispensado: {item.justificativa or 'sem justificativa registrada'}_"
        return f"_[PENDENTE — {item.label}]_"
    return v


def _fact_lines(facts: Iterable[dict[str, Any]], tipos: set[str]) -> list[str]:
    return [
        f"- **{f.get('tipo', '?')}**: {f.get('valor')}"
        for f in facts
        if f.get("tipo") in tipos
    ]


def _decision_lines(decisions: Iterable[dict[str, Any]], tipos: set[str]) -> list[str]:
    out: list[str] = []
    for d in decisions:
        if d.get("tipo") in tipos:
            line = f"- **{d.get('tipo')}**: {d.get('valor')}"
            if d.get("justificativa"):
                line += f" — _{d['justificativa']}_"
            out.append(line)
    return out


def render_etp_markdown(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    fontes: list[FonteUsuario],
) -> str:
    by_key: dict[str, ChecklistItem] = {}
    for items in checklist.by_category.values():
        for it in items:
            by_key[it.item_key] = it

    fontes_validadas = [f for f in fontes if f.status == FonteUsuarioStatus.VALIDADA]

    md: list[str] = []
    md.append(f"# Estudo Técnico Preliminar — Contratação {contratacao_id}")
    md.append("")
    md.append(f"_Gerado automaticamente em {datetime.utcnow().isoformat(timespec='seconds')}Z_")
    md.append("")

    md.append("## 1. Descrição da Necessidade")
    md.append(_line(by_key.get("demanda.problema_publico")))
    md.append("")
    md.append("**Objetivo específico:** " + _line(by_key.get("demanda.objetivo")))
    md.append("")
    md.append("**Unidade demandante:** " + _line(by_key.get("demanda.unidade_demandante")))
    md.append("")

    md.append("## 2. Previsão no PCA")
    md.append(_line(by_key.get("demanda.alinhamento_pca"), "_A confirmar com o setor de planejamento._"))
    md.append("")

    md.append("## 3. Requisitos da Contratação")
    md.append("**Funcionais:** " + _line(by_key.get("tec.requisitos_funcionais")))
    md.append("")
    md.append("**Não funcionais (SLA):** " + _line(by_key.get("tec.requisitos_nao_funcionais")))
    md.append("")
    md.append("**Segurança:** " + _line(by_key.get("tec.requisitos_seguranca")))
    md.append("")

    md.append("## 4. Estimativa das Quantidades")
    md.append(_line(by_key.get("qtd.matriz_quantitativos")))
    md.append("")
    md.append("**Justificativa do dimensionamento:** " + _line(by_key.get("qtd.justificativa_dimensionamento")))
    md.append("")
    qty_facts = _fact_lines(facts, {"quantidade", "vigencia", "lote"})
    if qty_facts:
        md.append("Fatos coletados na conversa:")
        md.extend(qty_facts)
        md.append("")

    md.append("## 5. Levantamento de Mercado")
    if fontes_validadas:
        md.append(f"Foram analisadas {len(fontes_validadas)} fonte(s) validada(s):")
        md.append("")
        md.append("| Fonte | Classificação | Score | Valor un./mês |")
        md.append("|---|---|---|---|")
        for f in fontes_validadas:
            ref = f.url or (f.produto or "(texto colado)")
            cls = f.classificacao.value if f.classificacao else "?"
            sc = f"{f.score:.2f}" if f.score is not None else "—"
            vmu = f"R$ {f.valor_mensal_unitario:,.2f}" if f.valor_mensal_unitario else "—"
            md.append(f"| {ref} | {cls} | {sc} | {vmu} |")
    else:
        md.append("_Nenhuma fonte validada. O sistema ainda buscará no PNCP/Compras._")
    md.append("")

    md.append("## 6. Estimativa de Valor")
    md.append(_line(by_key.get("precos.memoria_calculo")))
    md.append("")
    if fontes_validadas:
        valores = [f.valor_mensal_unitario for f in fontes_validadas if f.valor_mensal_unitario]
        if valores:
            media = sum(valores) / len(valores)
            md.append(f"**Valor unitário/mês de referência (média das fontes):** R$ {media:,.2f}")
            md.append("")
            # Memória de cálculo automática
            qtd_item = by_key.get("qtd.matriz_quantitativos")
            qtd_val = qtd_item.valor if qtd_item and qtd_item.valor is not None else None
            vig_item = by_key.get("escopo.vigencia") or by_key.get("qtd.vigencia")
            vig_val = vig_item.valor if vig_item and vig_item.valor is not None else None
            try:
                if qtd_val and vig_val:
                    qtd_n = float(qtd_val)
                    vig_n = float(vig_val)
                    total = media * qtd_n * vig_n
                    md.append("### Memória de cálculo")
                    md.append(
                        f"Valor unitário mensal × quantidade × vigência (meses) = "
                        f"R$ {media:,.2f} × {qtd_n:g} × {vig_n:g} meses = "
                        f"**R$ {total:,.2f}**"
                    )
                    md.append("")
            except (TypeError, ValueError):
                pass
            # Análise de dispersão
            if len(valores) >= 3:
                vmin, vmax = min(valores), max(valores)
                disp = (vmax - vmin) / media if media else 0
                md.append(
                    f"_Dispersão (max-min)/média = {disp*100:.1f}% "
                    f"(min R$ {vmin:,.2f} / max R$ {vmax:,.2f})._"
                )
                md.append("")

    md.append("## 7. Descrição da Solução como um todo")
    md.append(_line(by_key.get("escopo.objeto_resumido")))
    md.append("")

    md.append("## 8. Justificativa para Parcelamento")
    md.append(_line(by_key.get("escopo.lote"), "_A definir conforme análise de mercado._"))
    md.append("")

    md.append("## 9. Resultados e Benefícios Esperados")
    md.append(_line(by_key.get("demanda.objetivo")))
    md.append("")

    md.append("## 10. Providências da Administração")
    md.append("- " + _line(by_key.get("gestao.processo")))
    md.append("- Dotação orçamentária: " + _line(by_key.get("gestao.dotacao_orcamentaria")))
    md.append("- Gestor do contrato: " + _line(by_key.get("gestao.gestor_contrato")))
    md.append("- Fiscal do contrato: " + _line(by_key.get("gestao.fiscal_contrato")))
    md.append("- Autoridade competente: " + _line(by_key.get("gestao.autoridade_competente")))
    md.append("")

    md.append("## 11. Contratações Correlatas e Interdependentes")
    correlatas = _decision_lines(decisions, {"contratacao_correlata", "dependencia"})
    if correlatas:
        md.extend(correlatas)
    else:
        md.append("_Nenhuma contratação correlata identificada._")
    md.append("")

    md.append("## 12. Declaração de Viabilidade")
    md.append("Com base nos elementos acima, declara-se a viabilidade técnica e econômica da contratação,")
    md.append("ressalvada a confirmação dos campos institucionais marcados como pendentes.")
    md.append("")

    return "\n".join(md)
