"""Renderer TR — versão minimalista para Sprint D.

Reusa heurísticas do etp_renderer mas estrutura em 14 seções obrigatórias
do TR (Art. 24 IN SGD/ME 94/2022).

Dependências do checklist (extra além do ETP):
- tec.modelo_suporte (já é bloqueante para TR via REQUIRED_BLOCKING_FOR['tr'])
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from xerticaproc.backend.models.copilot_schemas import (
    ChecklistItem,
    ChecklistResponse,
    FonteUsuario,
    FonteUsuarioStatus,
)
from xerticaproc.backend.tools.etp_renderer import _line


def _flatten(checklist: ChecklistResponse) -> dict[str, ChecklistItem]:
    out: dict[str, ChecklistItem] = {}
    for items in checklist.by_category.values():
        for it in items:
            out[it.item_key] = it
    return out


def render_tr_markdown(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    fontes: list[FonteUsuario],
) -> str:
    by_key = _flatten(checklist)
    fontes_validadas = [f for f in fontes if f.status == FonteUsuarioStatus.VALIDADA]

    md: list[str] = []
    md.append(f"# Termo de Referência — Contratação {contratacao_id}")
    md.append("")
    md.append(f"_Gerado automaticamente em {datetime.utcnow().isoformat(timespec='seconds')}Z_")
    md.append("")

    md.append("## 1. Objeto")
    md.append(_line(by_key.get("escopo.objeto_resumido")))
    md.append("")

    md.append("## 2. Condições Gerais da Contratação")
    md.append("**Modalidade:** " + _line(by_key.get("escopo.modalidade")))
    md.append("")
    md.append("**Sistema de contratação:** " + _line(by_key.get("escopo.sistema_contratacao")))
    md.append("")
    md.append("**Lote:** " + _line(by_key.get("escopo.lote")))
    md.append("")
    md.append("**Prazo:** " + _line(by_key.get("escopo.prazo_meses")) + " meses")
    md.append("")

    md.append("## 3. Descrição da Solução como um todo")
    md.append(_line(by_key.get("escopo.objeto_resumido")))
    md.append("")

    md.append("## 4. Fundamentação e Descrição da Necessidade")
    md.append(_line(by_key.get("demanda.problema_publico")))
    md.append("")

    md.append("## 5. Requisitos da Contratação")
    md.append("**Funcionais:** " + _line(by_key.get("tec.requisitos_funcionais")))
    md.append("")
    md.append("**Não funcionais (SLA):** " + _line(by_key.get("tec.requisitos_nao_funcionais")))
    md.append("")
    md.append("**Segurança:** " + _line(by_key.get("tec.requisitos_seguranca")))
    md.append("")

    md.append("## 6. Modelo de Execução do Objeto")
    md.append(_line(by_key.get("tec.modelo_suporte")))
    md.append("")

    md.append("## 7. Modelo de Gestão do Contrato")
    md.append("- Gestor: " + _line(by_key.get("gestao.gestor_contrato")))
    md.append("- Fiscal: " + _line(by_key.get("gestao.fiscal_contrato")))
    md.append("")

    md.append("## 8. Critérios de Medição e Pagamento")
    md.append(_line(by_key.get("tec.modelo_suporte")))
    md.append("")

    md.append("## 9. Critérios de Seleção do Fornecedor")
    md.append("Conforme " + _line(by_key.get("escopo.modalidade")) + ", aplica-se o disposto na Lei 14.133/2021.")
    md.append("")

    md.append("## 10. Estimativas do Valor da Contratação")
    if fontes_validadas:
        valores = [f.valor_mensal_unitario for f in fontes_validadas if f.valor_mensal_unitario]
        if valores:
            media = sum(valores) / len(valores)
            md.append(f"**Valor unitário/mês de referência (média de {len(valores)} fonte(s)):** R$ {media:,.2f}")
            md.append("")
    md.append(_line(by_key.get("precos.memoria_calculo")))
    md.append("")

    md.append("## 11. Adequação Orçamentária")
    md.append(_line(by_key.get("gestao.dotacao_orcamentaria")))
    md.append("")

    md.append("## 12. Sanções Administrativas")
    md.append("Aplicam-se as sanções previstas no art. 156 da Lei 14.133/2021, conforme regulamentação do órgão.")
    md.append("")

    md.append("## 13. Proteção de Dados Pessoais (LGPD)")
    md.append("**Tratamento:** " + _line(by_key.get("lgpd.tratamento_dados")))
    md.append("")
    md.append("**Base legal:** " + _line(by_key.get("lgpd.base_legal")))
    md.append("")

    md.append("## 14. Anexos")
    if facts:
        md.append(f"- {len(facts)} fato(s) coletado(s) na conversa (anexo I)")
    if decisions:
        md.append(f"- {len(decisions)} decisão(ões) registrada(s) (anexo II)")
    if fontes_validadas:
        md.append(f"- {len(fontes_validadas)} fonte(s) de preço validada(s) (anexo III)")
    md.append("")

    return "\n".join(md)
