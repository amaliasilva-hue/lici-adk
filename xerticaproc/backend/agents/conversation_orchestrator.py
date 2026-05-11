"""Conversation Orchestrator — Copiloto de Contratações Públicas.

Recebe um turno do usuário, monta contexto, chama Gemini Flash com schema
estruturado, e retorna `ConversationTurnAnalysis`.

Modelo: gemini-2.5-flash, temp 0.3, response_schema forçado.

Funciona em 3 modos:
  - VERTEX (produção): usa vertexai.generative_models
  - GOOGLE_AI (dev): usa google.generativeai com GOOGLE_API_KEY
  - STUB (sem credenciais): heurística simples para permitir desenvolvimento local
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, AsyncIterator, Optional
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from xerticaproc.backend.agents import checklist_engine as ce
from xerticaproc.backend.models.copilot_schemas import (
    ConversationTurnAnalysis,
    DecisionToAdd,
    FactToAdd,
    FonteOrigem,
    MensagemRole,
    SuggestedAction,
    TurnIntent,
)
from xerticaproc.backend.tools import conversation_store as cs

log = logging.getLogger(__name__)


# ─── system prompt ───────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Você é o Copiloto de Contratações Públicas da Xertica, especialista em \
Lei 14.133/2021, IN SGD/ME 94/2022 e jurisprudência do TCU.

Sua missão: ajudar um servidor público a estruturar uma contratação completa \
(ETP, TR, mapa de preços, matriz de riscos) por meio de uma conversa natural e \
guiada — não por um formulário linear.

REGRAS INVIOLÁVEIS:
1. NUNCA invente fatos. Se não souber, marque como `pendente` ou pergunte.
2. NUNCA escreva campos de responsabilidade do órgão (dotação orçamentária, \
processo, gestor, fiscal). Eles ficam em aberto.
3. Toda decisão do usuário tem precedência sobre qualquer inferência sua.
4. Toda inferência sua é gravada como `confirmado=False` e exibida ao usuário \
com badge "inferido".
5. Se uma busca em PNCP/Compras retornar 0 resultados, REGISTRE como busca \
negativa antes de propor método paramétrico.
6. Preço paramétrico DEVE ser rotulado como "(método paramétrico)" no texto.
7. Produtos sem contratação corporativa registrada NÃO entram no mapa.

PRINCÍPIOS:
- Seja conciso. Bullets > parágrafos.
- Faça UMA pergunta por vez (`next_best_question`).
- Sempre que possível, ofereça 2-3 opções clicáveis (`suggested_actions`).
- Use o estado atual (facts, decisões, checklist) para evitar repetir.

SAÍDA: gere SEMPRE um ConversationTurnAnalysis JSON estrito.
- intent: confirmar_decisao | fornecer_fato | fornecer_fonte_preco | \
pedir_geracao | pedir_revisao | perguntar_processo | dispensar_item | \
override | outro
- user_response: texto a mostrar ao usuário
- next_best_question: próxima pergunta (ou null se aguardando ação)
- suggested_actions: chips de 1 clique

USE EXATAMENTE estes nomes de campo (em português) — NÃO traduza para inglês:
{
  "intent": "fornecer_fato",
  "facts_to_add": [
    {"tipo": "escopo.modalidade", "valor": "pregao_eletronico", "confianca": 0.9, "confirmado": true}
  ],
  "decisions_to_add": [
    {"tipo": "escopo.lote", "valor": "unico", "justificativa": "...", "fonte": "usuario"}
  ],
  "checklist_updates": [
    {"item_key": "escopo.modalidade", "status": "confirmado", "valor": "pregao_eletronico"}
  ],
  "price_sources_to_add": [],
  "calculations_to_run": [],
  "user_response": "...",
  "next_best_question": "...",
  "suggested_actions": [
    {"label": "Confirmar 12 meses", "command": "confirm_fact:escopo.prazo_meses=12"}
  ]
}

Os campos OBRIGATÓRIOS por item são exatamente: `tipo` (fact/decision), \
`item_key` (checklist), `label` e `command` (suggested_action). NÃO use \
`fato`, `path`, `key`, `item`, `text`, `field`, `confirmed` etc.
"""


# ─── modo de execução ────────────────────────────────────────────────────────

def _llm_mode() -> str:
    project = (
        os.environ.get("VERTEX_PROJECT")
        or os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
    )
    location = os.environ.get("VERTEX_LOCATION") or os.environ.get("GCP_LOCATION")
    if project and location:
        return "vertex"
    if os.environ.get("GOOGLE_API_KEY"):
        return "google_ai"
    return "stub"


# ─── chamada ao LLM ──────────────────────────────────────────────────────────

async def _call_vertex(
    prompt: str, extra_parts: Optional[list[Any]] = None,
) -> dict[str, Any]:
    """Chama Gemini 2.5 Flash via Vertex AI com response_schema.

    Se `extra_parts` for fornecido (lista de `vertexai.Part`), passa multimodal
    junto com o prompt — para análise de PDFs/imagens.
    """
    import vertexai
    from vertexai.generative_models import (
        GenerationConfig, GenerativeModel,
    )

    project = (
        os.environ.get("VERTEX_PROJECT")
        or os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
    )
    if not project:
        raise RuntimeError("Project for Vertex is not configured")
    location = os.environ.get("VERTEX_LOCATION") or os.environ.get("GCP_LOCATION") or "us-central1"
    model_name = os.environ.get("COPILOT_MODEL", "gemini-2.5-flash")

    vertexai.init(project=project, location=location)
    model = GenerativeModel(model_name=model_name, system_instruction=SYSTEM_PROMPT)

    schema = ConversationTurnAnalysis.model_json_schema()
    schema = _strip_pydantic_fields(schema)

    cfg = GenerationConfig(
        temperature=0.3,
        response_mime_type="application/json",
        response_schema=schema,
    )

    contents: list[Any] = [prompt]
    if extra_parts:
        contents.extend(extra_parts)

    def _sync_call() -> str:
        resp = model.generate_content(contents, generation_config=cfg)
        return resp.text

    raw = await asyncio.to_thread(_sync_call)
    return json.loads(raw)


async def _call_google_ai(
    prompt: str, extra_parts: Optional[list[Any]] = None,
) -> dict[str, Any]:
    """Chama Gemini via google.generativeai (modo dev com API key).

    `extra_parts` aqui são esperados como dicts no formato
    `{"mime_type": ..., "data": bytes}` para o SDK google-generativeai.
    """
    import google.generativeai as genai

    genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
    model_name = os.environ.get("COPILOT_MODEL", "gemini-2.5-flash")
    model = genai.GenerativeModel(
        model_name=model_name, system_instruction=SYSTEM_PROMPT
    )

    schema = ConversationTurnAnalysis.model_json_schema()
    schema = _strip_pydantic_fields(schema)

    contents: list[Any] = [prompt]
    if extra_parts:
        contents.extend(extra_parts)

    def _sync_call() -> str:
        resp = model.generate_content(
            contents,
            generation_config={
                "temperature": 0.3,
                "response_mime_type": "application/json",
                "response_schema": schema,
            },
        )
        return resp.text

    raw = await asyncio.to_thread(_sync_call)
    return json.loads(raw)


def _strip_pydantic_fields(schema: dict[str, Any]) -> dict[str, Any]:
    """Remove campos de schema JSON que Vertex não aceita."""
    drop = {
        "title",
        "$defs",
        "$ref",
        "definitions",
        "additionalProperties",
        "default",
    }

    def _normalize_nullable(node: dict[str, Any]) -> dict[str, Any]:
        any_of = node.get("anyOf")
        if not isinstance(any_of, list):
            return node
        non_null = [x for x in any_of if not (isinstance(x, dict) and x.get("type") == "null")]
        has_null = len(non_null) != len(any_of)
        if has_null and len(non_null) == 1 and isinstance(non_null[0], dict):
            merged = dict(node)
            merged.pop("anyOf", None)
            merged.update(non_null[0])
            merged["nullable"] = True
            return merged
        return node

    def _walk(node: Any) -> Any:
        if isinstance(node, dict):
            cleaned = {k: _walk(v) for k, v in node.items() if k not in drop}
            return _normalize_nullable(cleaned)
        if isinstance(node, list):
            return [_walk(x) for x in node]
        return node
    return _walk(schema)


def _stub_analysis(user_message: str, ctx: dict[str, Any]) -> dict[str, Any]:
    """Heurística simples para desenvolvimento local sem credenciais."""
    msg = user_message.lower().strip()
    facts: list[dict] = []
    decisions: list[dict] = []
    checklist_updates: list[dict] = []
    intent = "outro"

    # Detecta URLs como fontes de preço
    urls = re.findall(r"https?://\S+", user_message)
    price_sources: list[dict] = []
    if urls:
        intent = "fornecer_fonte_preco"
        for u in urls:
            price_sources.append({"tipo": "url", "url": u})

    # Detecta menções a modalidade
    if re.search(r"\bpreg(ã|a)o\b", msg):
        intent = "fornecer_fato"
        decisions.append({
            "tipo": "escopo.modalidade",
            "valor": "pregao_eletronico",
            "justificativa": "informado pelo usuário",
            "fonte": "usuario",
        })
        checklist_updates.append({
            "item_key": "escopo.modalidade",
            "status": "confirmado",
            "valor": "pregao_eletronico",
        })
    if re.search(r"\bdispensa\b", msg):
        intent = "fornecer_fato"
        decisions.append({
            "tipo": "escopo.modalidade",
            "valor": "dispensa",
            "justificativa": "informado pelo usuário",
            "fonte": "usuario",
        })
        checklist_updates.append({
            "item_key": "escopo.modalidade", "status": "confirmado", "valor": "dispensa",
        })
    if re.search(r"\blote (único|unico)\b", msg):
        decisions.append({
            "tipo": "escopo.lote", "valor": "unico",
            "justificativa": "informado pelo usuário", "fonte": "usuario",
        })
        checklist_updates.append({
            "item_key": "escopo.lote", "status": "confirmado", "valor": "unico",
        })

    # Prazo
    m = re.search(r"\b(\d{1,3})\s*meses\b", msg)
    if m:
        prazo = int(m.group(1))
        facts.append({"tipo": "escopo.prazo_meses", "valor": prazo,
                       "confianca": 0.95, "confirmado": True})
        checklist_updates.append({
            "item_key": "escopo.prazo_meses", "status": "confirmado", "valor": prazo,
        })

    if re.search(r"\bgerar\s+etp\b|\bpodemos gerar\b", msg):
        intent = "pedir_geracao"

    # próxima pergunta inteligente
    summary = ctx.get("checklist_summary", {})
    pending = summary.get("bloqueante_pendente", 0)
    if intent == "pedir_geracao":
        nbq = "Vou avaliar a prontidão do ETP. Pode confirmar?"
    elif pending > 0:
        nbq = f"Ainda temos {pending} item(s) bloqueante(s) pendente(s). Quer que eu liste?"
    else:
        nbq = "Posso ajudar com mais alguma definição (escopo, prazo, fontes de preço)?"

    return {
        "intent": intent,
        "facts_to_add": facts,
        "decisions_to_add": decisions,
        "checklist_updates": checklist_updates,
        "price_sources_to_add": price_sources,
        "calculations_to_run": [],
        "user_response": (
            "Recebido. (modo stub local — configure VERTEX_PROJECT ou "
            "GOOGLE_API_KEY para análise IA real)."
        ) if intent == "outro" else _stub_response_for(intent, user_message),
        "next_best_question": nbq,
        "suggested_actions": [],
    }


def _stub_response_for(intent: str, msg: str) -> str:
    if intent == "fornecer_fonte_preco":
        return "Recebi o(s) link(s). Vou validar e adicionar ao Price Workbench."
    if intent == "fornecer_fato":
        return "Anotado. Atualizei o checklist com essas informações."
    if intent == "pedir_geracao":
        return "Vou consultar o readiness do documento."
    return "Anotado."


async def _analyze(
    prompt: str,
    ctx: dict[str, Any],
    user_message: str,
    extra_parts: Optional[list[Any]] = None,
) -> ConversationTurnAnalysis:
    mode = _llm_mode()
    try:
        if mode == "vertex":
            data = await _call_vertex(prompt, extra_parts=extra_parts)
        elif mode == "google_ai":
            data = await _call_google_ai(prompt, extra_parts=extra_parts)
        else:
            log.info("ConversationOrchestrator em modo STUB (sem credenciais)")
            data = _stub_analysis(user_message, ctx)
        return ConversationTurnAnalysis.model_validate(data)
    except (ValidationError, json.JSONDecodeError) as e:
        log.warning("Falha ao validar análise (%s); usando fallback stub", e)
        data = _stub_analysis(user_message, ctx)
        return ConversationTurnAnalysis.model_validate(data)
    except Exception as e:  # noqa: BLE001
        log.exception("Erro chamando LLM (%s); usando fallback stub", e)
        data = _stub_analysis(user_message, ctx)
        return ConversationTurnAnalysis.model_validate(data)


# ─── montagem do contexto ────────────────────────────────────────────────────

def _build_prompt(
    *,
    user_message: str,
    facts: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    checklist_summary: dict[str, Any],
    recent: list[dict[str, str]],
    resumo: Optional[str],
    anexos_block: str = "",
) -> str:
    parts: list[str] = []
    if resumo:
        parts.append(f"## Resumo da conversa anterior\n{resumo}\n")
    parts.append("## Estado atual\n")
    parts.append(f"### Fatos confirmados/inferidos ({len(facts)}):\n")
    for f in facts[:30]:
        flag = "✓" if f.get("confirmado") else "~"
        parts.append(f"- {flag} {f['tipo']} = {json.dumps(f['valor'], ensure_ascii=False)} (conf={f['confianca']:.2f})")
    parts.append(f"\n### Decisões registradas ({len(decisions)}):\n")
    for d in decisions[:30]:
        parts.append(f"- {d['tipo']} = {json.dumps(d['valor'], ensure_ascii=False)} [{d['fonte']}]"
                     + (f" — {d['justificativa']}" if d.get("justificativa") else ""))
    parts.append(f"\n### Resumo do checklist:\n{json.dumps(checklist_summary, ensure_ascii=False)}\n")

    # Lista canônica de item_keys válidos — o LLM NÃO deve inventar outras
    try:
        from xerticaproc.backend.agents.checklist_engine import CHECKLIST_SEED
        valid_keys = [it["item_key"] for it in CHECKLIST_SEED]
        parts.append(
            "\n### item_keys válidos (use APENAS estes em checklist_updates; "
            "NÃO invente novos):\n"
            + ", ".join(valid_keys) + "\n"
        )
    except Exception:  # noqa: BLE001
        pass

    parts.append("\n## Últimas mensagens\n")
    for m in recent:
        parts.append(f"**{m['role']}**: {m['content']}")

    if anexos_block:
        parts.append(anexos_block)

    parts.append(f"\n## Mensagem atual do usuário\n{user_message}\n")
    parts.append("\nGere agora a análise estruturada (ConversationTurnAnalysis JSON).")
    return "\n".join(parts)


# ─── handle_turn (entrada principal) ─────────────────────────────────────────

async def _summarize_history(
    msgs: list, prev: Optional[str] = None, *, max_chars: int = 4000,
) -> Optional[str]:
    """Compacta o histórico em um resumo breve (≤max_chars).

    Usa Gemini quando disponível; cai em heurística de truncamento se não.
    Recebe lista de MensagemOut (do conversation_store.list_messages).
    """
    try:
        bullets: list[str] = []
        for m in msgs[-32:]:
            role = getattr(m, "role", None)
            role_str = role.value if hasattr(role, "value") else str(role)
            txt = (getattr(m, "conteudo", "") or "")[:400]
            bullets.append(f"- {role_str}: {txt}")
        body = "\n".join(bullets)
        prefix = f"Resumo prévio:\n{prev}\n\n" if prev else ""
        prompt = (
            f"{prefix}Compacte a conversa abaixo em um resumo objetivo "
            f"(até 6 parágrafos curtos), preservando: necessidade, escopo, "
            f"valores, decisões e pendências críticas. Use linguagem técnica.\n\n"
            f"Mensagens:\n{body}"
        )
        mode = _llm_mode()
        if mode == "vertex":
            import vertexai
            from vertexai.generative_models import GenerationConfig, GenerativeModel
            project = os.environ.get("GCP_PROJECT_ID")
            location = os.environ.get("GCP_LOCATION", "us-central1")
            vertexai.init(project=project, location=location)
            model = GenerativeModel(
                model_name=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
            )
            cfg = GenerationConfig(temperature=0.2, max_output_tokens=1024)
            resp = await asyncio.to_thread(
                model.generate_content, prompt, generation_config=cfg,
            )
            txt = (resp.text or "").strip()
            return txt[:max_chars] if txt else None
        if mode == "google_ai":
            import google.generativeai as genai
            genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
            model = genai.GenerativeModel(
                os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
            )
            resp = await asyncio.to_thread(model.generate_content, prompt)
            txt = (resp.text or "").strip()
            return txt[:max_chars] if txt else None
        # Fallback heurístico
        return body[:max_chars]
    except Exception:
        log.exception("Falha em _summarize_history")
        return None


async def handle_turn(
    session: AsyncSession,
    *,
    contratacao_id: str | UUID,
    user_message: str,
    anexos: Optional[list] = None,
) -> dict[str, Any]:
    """Processa um turno completo. Retorna dict com payload para SSE/JSON.

    Persistência:
      - mensagem do usuário
      - chamada LLM
      - persistência de facts/decisões/checklist updates
      - mensagem do assistente
      - resumo (se conversa > 16 mensagens)
    """
    cid = str(contratacao_id)
    conversa_id = await cs.get_or_create_conversa(session, cid)

    # garante checklist seedado
    items = await ce.list_items(session, cid)
    if not items:
        await ce.seed_checklist(session, cid)

    # 1) persiste mensagem do usuário
    user_msg_id = await cs.append_message(
        session,
        conversa_id=conversa_id,
        contratacao_id=cid,
        role=MensagemRole.USER,
        conteudo=user_message,
        anexos=anexos,
    )

    # 1.1) cria refs na biblioteca de documentos para anexos com gcs_uri
    if anexos:
        try:
            from xerticaproc.backend.tools import documentos_store as ds
            for a in anexos:
                if not a.gcs_uri:
                    continue
                row = (await session.execute(
                    text("""
                        SELECT id FROM biblioteca_documentos
                         WHERE contratacao_id = :cid AND storage_uri = :uri
                         LIMIT 1
                    """),
                    {"cid": str(cid), "uri": a.gcs_uri},
                )).first()
                if row:
                    await ds.link_message_documento(
                        session,
                        mensagem_id=user_msg_id,
                        documento_id=str(row.id),
                        papel="anexado_pelo_usuario",
                    )
        except Exception:
            log.exception("link mensagem→documento falhou cid=%s", cid)

    # 2) monta contexto
    facts = await cs.list_facts(session, cid)
    decisions = await cs.list_decisions(session, cid)
    checklist = await ce.get_response(session, cid)
    recent = await cs.recent_messages_for_context(session, cid, n=8)
    resumo = await cs.get_resumo(session, conversa_id)

    # 2.1) processa anexos multimodais (PDF/imagem/DOCX/XLSX) — se houver
    anexos_block = ""
    extra_parts: list[Any] = []
    if anexos:
        try:
            from xerticaproc.backend.tools import document_extractor as dx
            extracted = await dx.process_anexos(anexos)
            anexos_block = dx.render_anexos_for_prompt(extracted)
            extra_parts = dx.collect_gemini_parts(extracted)
            log.info(
                "anexos_processed cid=%s n=%d parts=%d",
                cid, len(extracted), len(extra_parts),
            )
        except Exception:
            log.exception("Falha processando anexos cid=%s", cid)

    prompt = _build_prompt(
        user_message=user_message,
        facts=facts,
        decisions=decisions,
        checklist_summary=checklist.summary.model_dump(),
        recent=recent,
        resumo=resumo,
        anexos_block=anexos_block,
    )

    # 3) chama LLM
    analysis = await _analyze(
        prompt,
        {"checklist_summary": checklist.summary.model_dump()},
        user_message,
        extra_parts=extra_parts or None,
    )

    # 4) persiste mensagem do assistente
    assistant_msg_id = await cs.append_message(
        session,
        conversa_id=conversa_id,
        contratacao_id=cid,
        role=MensagemRole.ASSISTANT,
        conteudo=analysis.user_response,
        meta={
            "intent": analysis.intent.value,
            "next_best_question": analysis.next_best_question,
            "suggested_actions": [a.model_dump() for a in analysis.suggested_actions],
        },
    )

    # 5) persiste facts/decisões/checklist updates
    persisted = await cs.persist_turn_analysis(
        session,
        contratacao_id=cid,
        user_message_id=user_msg_id,
        assistant_message_id=assistant_msg_id,
        analysis=analysis,
    )

    # 6) compactação de contexto a cada 16 mensagens
    try:
        all_msgs = await cs.list_messages(session, cid, limit=200)
        if len(all_msgs) >= 16 and len(all_msgs) % 16 == 0:
            new_resumo = await _summarize_history(all_msgs, prev=resumo)
            if new_resumo:
                await cs.update_resumo(session, conversa_id, new_resumo)
    except Exception:
        log.exception("Falha na compactação de contexto cid=%s", cid)

    return {
        "user_message_id": user_msg_id,
        "assistant_message_id": assistant_msg_id,
        "analysis": analysis.model_dump(),
        "persisted": persisted,
    }


# ─── streaming SSE (assistente token a token) ────────────────────────────────

async def handle_turn_stream(
    session: AsyncSession,
    *,
    contratacao_id: str | UUID,
    user_message: str,
    anexos: Optional[list] = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Versão streaming. Yield (event_name, data_dict).

    Eventos: assistant_token, facts_added, decisions_added, checklist_updated,
    price_sources_added, turn_complete.
    """
    result = await handle_turn(
        session,
        contratacao_id=contratacao_id,
        user_message=user_message,
        anexos=anexos,
    )
    analysis = ConversationTurnAnalysis.model_validate(result["analysis"])

    # Stream do texto da resposta token-por-token (chunks)
    text = analysis.user_response
    chunk_size = 24
    for i in range(0, len(text), chunk_size):
        yield "assistant_token", {"text": text[i:i + chunk_size]}
        await asyncio.sleep(0.01)

    if analysis.facts_to_add:
        yield "facts_added", {"facts": [f.model_dump() for f in analysis.facts_to_add]}
    if analysis.decisions_to_add:
        yield "decisions_added", {"decisions": [d.model_dump() for d in analysis.decisions_to_add]}
    if analysis.checklist_updates:
        yield "checklist_updated", {
            "updates": [u.model_dump() for u in analysis.checklist_updates],
            "keys": result["persisted"]["checklist_keys"],
        }
    if analysis.price_sources_to_add:
        yield "price_sources_added", {
            "sources": [p.model_dump() for p in analysis.price_sources_to_add],
        }

    yield "turn_complete", {
        "message_id": result["assistant_message_id"],
        "intent": analysis.intent.value,
        "next_best_question": analysis.next_best_question,
        "suggested_actions": [a.model_dump() for a in analysis.suggested_actions],
    }
