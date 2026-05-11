"""LLM-based ETP/TR writer for the Copilot flow.

Receives the FULL conversation transcript + checklist + facts/decisions/sources
and asks Gemini 2.5 Pro to produce well-written Markdown grounded ONLY in that
material, following the legal structure (Lei 14.133/2021 + IN SGD/ME 94/2022).

Falls back to the deterministic template renderer if Vertex is not available
or if the call fails — so dev mode and outages stay safe.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

from xerticaproc.backend.models.copilot_schemas import (
    ChecklistItem,
    ChecklistResponse,
    FonteUsuario,
    FonteUsuarioStatus,
    MensagemOut,
)

log = logging.getLogger("xerticaproc.agents.llm_doc_writer")


_ETP_STRUCTURE = """\
1. Descrição da Necessidade
2. Previsão no Plano de Contratações Anual (PCA)
3. Requisitos da Contratação (Funcionais, Não Funcionais/SLA, Segurança/LGPD)
4. Estimativa das Quantidades (com justificativa do dimensionamento)
5. Levantamento de Mercado
6. Estimativa de Valor (memória de cálculo)
7. Descrição da Solução como um todo
8. Justificativa para o Parcelamento (ou não)
9. Resultados e Benefícios Esperados
10. Providências a serem adotadas pela Administração
11. Contratações Correlatas e Interdependentes
12. Declaração de Viabilidade
"""

_TR_STRUCTURE = """\
1. Objeto
2. Condições Gerais da Contratação
3. Descrição da Solução como um todo
4. Fundamentação e Descrição da Necessidade
5. Requisitos da Contratação (Funcionais, Não Funcionais/SLA, Segurança)
6. Modelo de Execução do Objeto
7. Modelo de Gestão do Contrato
8. Critérios de Medição e Pagamento
9. Critérios de Seleção do Fornecedor
10. Estimativas do Valor da Contratação
11. Adequação Orçamentária
12. Sanções Administrativas
13. Proteção de Dados Pessoais (LGPD)
14. Anexos (se houver)
"""


def _system_prompt(doc_label: str, structure: str) -> str:
    return f"""Você é redator(a) sênior de documentos de contratação pública \
da plataforma xerticaproc, especialista em Lei 14.133/2021 e IN SGD/ME 94/2022.

Sua tarefa é redigir um {doc_label} com qualidade de produção, em português \
brasileiro formal, no padrão da Administração Pública.

Estrutura obrigatória ({doc_label}):
{structure}

Regras invioláveis:
1. Use APENAS as informações presentes no material fornecido (transcrição da \
conversa com o usuário, checklist, fatos, decisões e fontes). NÃO invente \
órgãos, números, prazos, fornecedores, valores, leis, portarias ou requisitos.
2. Se um campo institucional estiver pendente (ex.: dotação orçamentária, \
fiscal, gestor, nº de processo), use o placeholder \
"_[PENDENTE — descrição (responsabilidade do órgão)]_". NÃO preencha.
3. Reescreva e estruture o conteúdo em texto contínuo, com parágrafos coesos. \
NÃO copie literalmente blocos enormes do checklist — interprete, organize em \
sub-tópicos, listas e tabelas onde apropriado, e elimine redundâncias.
4. Em cada seção, NÃO repita o mesmo bloco de texto que já apareceu em outra \
seção. Por exemplo: requisitos de segurança vão SOMENTE em "Segurança", \
não dentro de "Não Funcionais".
5. Quando houver fontes de preço validadas, cite-as explicitamente \
(ex.: "Fonte: ARP 2024-0012 — R$ 150,00/usuário/mês"). Se não houver fontes, \
diga claramente que o levantamento de mercado deverá ser complementado.
6. Tom: formal, objetivo, técnico. Evite jargão de marketing.
7. Saída: APENAS Markdown válido, começando com "# {doc_label} — ..." e \
usando "## N. Título" para as seções principais. Não inclua comentários \
fora do documento, nem cercas de código (```).
"""


def _flatten_checklist(checklist: ChecklistResponse) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cat, items in checklist.by_category.items():
        for it in items:
            out.append({
                "categoria": cat,
                "item_key": it.item_key,
                "label": it.label,
                "status": it.status.value if hasattr(it.status, "value") else str(it.status),
                "owner": it.owner.value if hasattr(it.owner, "value") else str(it.owner),
                "criticidade": it.criticidade.value if hasattr(it.criticidade, "value") else str(it.criticidade),
                "valor": it.valor,
                "justificativa": it.justificativa,
            })
    return out


def _serialize_fontes(fontes: list[FonteUsuario]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for f in fontes:
        if f.status != FonteUsuarioStatus.VALIDADA:
            continue
        out.append({
            "tipo": f.tipo,
            "produto": f.produto,
            "url": f.url,
            "valor_total": f.valor_total,
            "quantidade": f.quantidade,
            "vigencia_meses": f.vigencia_meses,
            "valor_mensal_unitario": f.valor_mensal_unitario,
            "classificacao": f.classificacao.value if f.classificacao else None,
            "observacao": f.observacao,
        })
    return out


def _serialize_messages(messages: list[MensagemOut], max_chars: int = 60_000) -> list[dict[str, str]]:
    """Serialize the chat transcript, capping size from the most recent end."""
    out: list[dict[str, str]] = []
    total = 0
    # Walk newest -> oldest, then reverse, to keep most recent within budget.
    for m in reversed(messages):
        body = (m.conteudo or "").strip()
        if not body:
            continue
        size = len(body)
        if total + size > max_chars and out:
            break
        out.append({
            "role": m.role.value if hasattr(m.role, "value") else str(m.role),
            "content": body,
        })
        total += size
    out.reverse()
    return out


def _build_prompt(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    fontes: list[FonteUsuario],
    messages: list[MensagemOut],
) -> str:
    payload = {
        "contratacao_id": contratacao_id,
        "checklist": _flatten_checklist(checklist),
        "facts": [
            {"tipo": f.get("tipo"), "valor": f.get("valor"), "confianca": f.get("confianca")}
            for f in facts
        ],
        "decisions": [
            {"tipo": d.get("tipo"), "valor": d.get("valor"), "justificativa": d.get("justificativa")}
            for d in decisions
        ],
        "fontes_validadas": _serialize_fontes(fontes),
        "transcricao_conversa": _serialize_messages(messages),
    }
    return (
        "Material disponível para a redação (JSON):\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n\nAgora redija o documento em Markdown, seguindo TODAS as regras."
    )


def _vertex_available() -> bool:
    return bool(
        os.environ.get("VERTEX_PROJECT")
        or os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
    )


async def _call_vertex(system: str, prompt: str) -> str:
    import vertexai
    from vertexai.generative_models import GenerationConfig, GenerativeModel

    project = (
        os.environ.get("VERTEX_PROJECT")
        or os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
    )
    location = (
        os.environ.get("VERTEX_LOCATION")
        or os.environ.get("GCP_LOCATION")
        or "us-central1"
    )
    # Documento longo e formal: preferir Pro quando disponível, com fallback
    # para o modelo padrão do Copilot.
    model_name = (
        os.environ.get("DOC_WRITER_MODEL")
        or os.environ.get("REDATOR_MODEL")
        or os.environ.get("COPILOT_MODEL")
        or "gemini-2.5-pro"
    )

    vertexai.init(project=project, location=location)
    model = GenerativeModel(model_name=model_name, system_instruction=system)
    cfg = GenerationConfig(temperature=0.3, max_output_tokens=8192)

    def _sync_call() -> str:
        resp = model.generate_content(prompt, generation_config=cfg)
        return resp.text or ""

    return await asyncio.to_thread(_sync_call)


def _strip_code_fences(md: str) -> str:
    s = md.strip()
    if s.startswith("```"):
        # remove first fence line
        s = s.split("\n", 1)[1] if "\n" in s else ""
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()


async def _render_with_llm(
    *,
    doc_label: str,
    structure: str,
    contratacao_id: str,
    checklist: ChecklistResponse,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    fontes: list[FonteUsuario],
    messages: list[MensagemOut],
) -> Optional[str]:
    if not _vertex_available():
        log.info("llm_doc_writer.skip reason=no_vertex_project")
        return None
    try:
        system = _system_prompt(doc_label, structure)
        prompt = _build_prompt(
            contratacao_id=contratacao_id,
            checklist=checklist,
            facts=facts,
            decisions=decisions,
            fontes=fontes,
            messages=messages,
        )
        log.info(
            "llm_doc_writer.start cid=%s doc=%s msgs=%s fontes=%s",
            contratacao_id, doc_label, len(messages), len(fontes),
        )
        raw = await _call_vertex(system, prompt)
        text = _strip_code_fences(raw)
        if len(text) < 200:
            log.warning(
                "llm_doc_writer.too_short cid=%s len=%s — usando fallback template",
                contratacao_id, len(text),
            )
            return None
        return text
    except Exception:  # noqa: BLE001
        log.exception("llm_doc_writer.error cid=%s doc=%s", contratacao_id, doc_label)
        return None


async def render_etp(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    fontes: list[FonteUsuario],
    messages: list[MensagemOut],
) -> Optional[str]:
    """Try LLM-based ETP rendering. Returns None if it failed (caller falls back)."""
    return await _render_with_llm(
        doc_label="Estudo Técnico Preliminar",
        structure=_ETP_STRUCTURE,
        contratacao_id=contratacao_id,
        checklist=checklist,
        facts=facts,
        decisions=decisions,
        fontes=fontes,
        messages=messages,
    )


async def render_tr(
    *,
    contratacao_id: str,
    checklist: ChecklistResponse,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    fontes: list[FonteUsuario],
    messages: list[MensagemOut],
) -> Optional[str]:
    """Try LLM-based TR rendering. Returns None if it failed (caller falls back)."""
    return await _render_with_llm(
        doc_label="Termo de Referência",
        structure=_TR_STRUCTURE,
        contratacao_id=contratacao_id,
        checklist=checklist,
        facts=facts,
        decisions=decisions,
        fontes=fontes,
        messages=messages,
    )
