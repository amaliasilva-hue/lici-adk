"""Renderer Mapa de Preços — Sprint D.

Gera markdown estruturado + bloco CSV embedded para fácil exportação.
Categoriza fontes por classificação, aplica estatísticas básicas (média,
mediana, dispersão) e sinaliza outliers.
"""
from __future__ import annotations

import statistics
from datetime import datetime
from typing import Optional

from xerticaproc.backend.models.copilot_schemas import (
    ChecklistResponse,
    ClassificacaoPreco,
    FonteUsuario,
    FonteUsuarioStatus,
    PesquisaNegativa,
)


def _fmt_brl(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"R$ {v:,.2f}"


def _stats(valores: list[float]) -> dict[str, float]:
    if not valores:
        return {}
    return {
        "min": min(valores),
        "max": max(valores),
        "media": sum(valores) / len(valores),
        "mediana": statistics.median(valores),
        "dispersao": (max(valores) - min(valores)) / max(valores) if max(valores) else 0.0,
    }


def render_mapa_precos_markdown(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    fontes: list[FonteUsuario],
    negativas: list[PesquisaNegativa],
) -> str:
    fontes_validadas = [f for f in fontes if f.status == FonteUsuarioStatus.VALIDADA]

    md: list[str] = []
    md.append(f"# Mapa de Preços — Contratação {contratacao_id}")
    md.append("")
    md.append(f"_Gerado automaticamente em {datetime.utcnow().isoformat(timespec='seconds')}Z_")
    md.append("")
    md.append(f"**Total de fontes validadas:** {len(fontes_validadas)}")
    md.append(f"**Buscas negativas registradas:** {len(negativas)}")
    md.append("")

    # Agrupa por classificação
    grupos: dict[str, list[FonteUsuario]] = {}
    for f in fontes_validadas:
        key = f.classificacao.value if f.classificacao else "sem_classificacao"
        grupos.setdefault(key, []).append(f)

    md.append("## 1. Fontes por classificação")
    md.append("")
    md.append("| Classificação | # | Valor un./mês médio | Dispersão |")
    md.append("|---|---|---|---|")
    for cls in ["direta", "indireta", "parametrica", "complementar", "outlier"]:
        gs = grupos.get(cls, [])
        valores = [f.valor_mensal_unitario for f in gs if f.valor_mensal_unitario]
        s = _stats([v for v in valores if v is not None])
        media = s.get("media")
        disp = s.get("dispersao", 0.0)
        md.append(
            f"| {cls} | {len(gs)} | {_fmt_brl(media)} | "
            f"{disp * 100:.1f}% |" if media else f"| {cls} | {len(gs)} | — | — |"
        )
    md.append("")

    md.append("## 2. Fontes detalhadas")
    md.append("")
    md.append("| # | Fonte | Classif. | Score | Valor total | Qtd | Vig. (m) | Valor un./mês |")
    md.append("|---|---|---|---|---|---|---|---|")
    for i, f in enumerate(fontes_validadas, start=1):
        ref = f.url or f.produto or "(texto colado)"
        cls = f.classificacao.value if f.classificacao else "?"
        sc = f"{f.score:.2f}" if f.score is not None else "—"
        md.append(
            f"| {i} | {ref} | {cls} | {sc} | {_fmt_brl(f.valor_total)} | "
            f"{f.quantidade or '—'} | {f.vigencia_meses or '—'} | "
            f"{_fmt_brl(f.valor_mensal_unitario)} |"
        )
    md.append("")

    # Estimativa final
    diretas = grupos.get("direta", [])
    indiretas = grupos.get("indireta", [])
    base = diretas or indiretas
    valores_base = [f.valor_mensal_unitario for f in base if f.valor_mensal_unitario]
    md.append("## 3. Estimativa de referência")
    md.append("")
    if valores_base:
        s = _stats([v for v in valores_base if v is not None])
        md.append(f"- **Base de cálculo:** {len(valores_base)} fonte(s) {'direta(s)' if diretas else 'indireta(s)'}")
        md.append(f"- **Mínimo:** {_fmt_brl(s['min'])}")
        md.append(f"- **Máximo:** {_fmt_brl(s['max'])}")
        md.append(f"- **Média:** {_fmt_brl(s['media'])}")
        md.append(f"- **Mediana:** {_fmt_brl(s['mediana'])}")
        md.append(f"- **Dispersão:** {s['dispersao'] * 100:.1f}%")
        md.append("")
        if s["dispersao"] > 0.30:
            md.append("> ⚠️  Dispersão > 30%. Recomenda-se análise crítica e descarte de outliers.")
            md.append("")
    else:
        md.append("_Nenhuma fonte direta ou indireta disponível para cálculo._")
        md.append("")

    # Buscas negativas
    if negativas:
        md.append("## 4. Buscas negativas registradas")
        md.append("")
        for n in negativas:
            md.append(f"- **{n.termo}** — fontes consultadas: {', '.join(n.fontes_consultadas) or '—'}")
            if n.justificativa:
                md.append(f"  - _justificativa:_ {n.justificativa}")
        md.append("")

    # Bloco CSV embedded
    md.append("## 5. CSV (para colar em planilha)")
    md.append("")
    md.append("```csv")
    md.append("idx,fonte,classificacao,score,valor_total,quantidade,vigencia_meses,valor_mensal_unitario")
    for i, f in enumerate(fontes_validadas, start=1):
        ref = (f.url or f.produto or "texto").replace(",", " ")
        cls = f.classificacao.value if f.classificacao else ""
        md.append(
            f"{i},{ref},{cls},{f.score or ''},{f.valor_total or ''},"
            f"{f.quantidade or ''},{f.vigencia_meses or ''},"
            f"{f.valor_mensal_unitario or ''}"
        )
    md.append("```")
    md.append("")

    return "\n".join(md)
