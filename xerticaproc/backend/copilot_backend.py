"""Copilot Backend — abstração entre Postgres (produção) e in-memory (dev).

A implementação in-memory permite rodar o chat copilot sem AlloyDB,
facilitando dev local e testes. A Postgres delega aos módulos
`tools.conversation_store` e `agents.checklist_engine`.

A escolha é feita em runtime via env `ALLOYDB_URL`.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional, Protocol
from uuid import UUID

from xerticaproc.backend.agents import checklist_engine as ce
from xerticaproc.backend.models.copilot_schemas import (
    Anexo,
    ChecklistCriticidade,
    ChecklistItem,
    ChecklistOwner,
    ChecklistResponse,
    ChecklistStatus,
    ChecklistSummary,
    ConversationTurnAnalysis,
    DocumentReadiness,
    DocumentoGeradoLite,
    FonteUsuario,
    FonteUsuarioIn,
    FonteUsuarioPatch,
    FonteUsuarioStatus,
    MensagemOut,
    MensagemRole,
    PesquisaNegativa,
    PesquisaNegativaIn,
)

log = logging.getLogger(__name__)


class CopilotBackend(Protocol):
    async def ensure_seed(self, contratacao_id: str) -> None: ...
    async def handle_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> dict[str, Any]: ...
    async def stream_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]: ...
    async def list_history(
        self, contratacao_id: str, limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[MensagemOut]: ...
    async def get_checklist(self, contratacao_id: str) -> ChecklistResponse: ...
    async def patch_checklist_item(
        self,
        contratacao_id: str,
        item_key: str,
        *,
        status: ChecklistStatus,
        valor: Optional[Any] = None,
        justificativa: Optional[str] = None,
    ) -> Optional[ChecklistItem]: ...
    # Sprint B
    async def list_sources(self, contratacao_id: str) -> list[FonteUsuario]: ...
    async def add_source(
        self, contratacao_id: str, payload: FonteUsuarioIn,
    ) -> FonteUsuario: ...
    async def patch_source(
        self, contratacao_id: str, source_id: str, payload: FonteUsuarioPatch,
    ) -> Optional[FonteUsuario]: ...
    async def list_negative_searches(
        self, contratacao_id: str,
    ) -> list[PesquisaNegativa]: ...
    async def add_negative_search(
        self, contratacao_id: str, payload: PesquisaNegativaIn,
    ) -> PesquisaNegativa: ...
    # Sprint C
    async def evaluate_readiness(
        self, contratacao_id: str, doc_type: str,
    ) -> DocumentReadiness: ...
    async def generate_document(
        self, contratacao_id: str, doc_type: str,
    ) -> DocumentoGeradoLite: ...
    async def list_documents(
        self, contratacao_id: str,
    ) -> list[DocumentoGeradoLite]: ...
    # Sprint D
    async def review_documents(self, contratacao_id: str) -> Any: ...
    async def build_evidence_pack(self, contratacao_id: str) -> bytes: ...

# ─────────────────────────────────────────────────────────────────────────────
# In-memory backend (dev / testes)
# ─────────────────────────────────────────────────────────────────────────────

class InMemoryCopilotBackend:
    def __init__(self) -> None:
        # contratacao_id -> { conversa_id, mensagens[], facts[], decisions[],
        #                     checklist{item_key: ChecklistItem},
        #                     fontes{source_id: FonteUsuario},
        #                     pesquisas_negativas[] }
        self._data: dict[str, dict[str, Any]] = {}

    def _state(self, cid: str) -> dict[str, Any]:
        st = self._data.get(cid)
        if st is None:
            st = {
                "conversa_id": str(uuid.uuid4()),
                "resumo": None,
                "mensagens": [],
                "facts": [],
                "decisions": [],
                "checklist": {},
                "fontes": {},
                "pesquisas_negativas": [],
                "documentos": [],
                "aprovacoes": [],
                "eventos": [],
            }
            self._data[cid] = st
        return st

    async def ensure_seed(self, contratacao_id: str) -> None:
        st = self._state(contratacao_id)
        if st["checklist"]:
            return
        for it in ce.CHECKLIST_SEED:
            st["checklist"][it["item_key"]] = ChecklistItem(
                item_key=it["item_key"],
                categoria=it["categoria"],
                label=it["label"],
                status=ChecklistStatus.PENDENTE,
                criticidade=ChecklistCriticidade(it["criticidade"]),
                owner=ChecklistOwner(it["owner"]),
                atualizado_em=datetime.now(timezone.utc),
            )

    async def handle_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> dict[str, Any]:
        from xerticaproc.backend.agents.conversation_orchestrator import (
            _analyze, _build_prompt,
        )

        await self.ensure_seed(contratacao_id)
        st = self._state(contratacao_id)

        # 1) registra mensagem do usuário
        user_msg_id = str(uuid.uuid4())
        st["mensagens"].append(MensagemOut(
            id=UUID(user_msg_id),
            role=MensagemRole.USER,
            conteudo=user_message,
            anexos=anexos or [],
            criado_em=datetime.now(timezone.utc),
        ))

        # 2) contexto
        checklist = await self.get_checklist(contratacao_id)
        recent = [
            {"role": m.role.value, "content": m.conteudo}
            for m in st["mensagens"][-8:]
        ]
        prompt = _build_prompt(
            user_message=user_message,
            facts=st["facts"],
            decisions=st["decisions"],
            checklist_summary=checklist.summary.model_dump(),
            recent=recent,
            resumo=st["resumo"],
        )

        # 3) LLM
        analysis = await _analyze(
            prompt,
            {"checklist_summary": checklist.summary.model_dump()},
            user_message,
        )

        # 4) persiste mensagem assistente
        assistant_msg_id = str(uuid.uuid4())
        st["mensagens"].append(MensagemOut(
            id=UUID(assistant_msg_id),
            role=MensagemRole.ASSISTANT,
            conteudo=analysis.user_response,
            meta={
                "intent": analysis.intent.value,
                "next_best_question": analysis.next_best_question,
                "suggested_actions": [a.model_dump() for a in analysis.suggested_actions],
            },
            criado_em=datetime.now(timezone.utc),
        ))

        # 5) facts
        fact_ids: list[str] = []
        for f in analysis.facts_to_add:
            fid = str(uuid.uuid4())
            st["facts"].append({
                "id": fid, "tipo": f.tipo, "valor": f.valor,
                "confianca": f.confianca, "confirmado": f.confirmado,
                "fonte_mensagem_id": user_msg_id,
                "criado_em": datetime.now(timezone.utc).isoformat(),
            })
            fact_ids.append(fid)

        # 6) decisões (G18 in-memory)
        decision_ids: list[str] = []
        for d in analysis.decisions_to_add:
            if d.fonte.value == "sistema":
                exists = any(
                    x for x in st["decisions"]
                    if x["tipo"] == d.tipo and x["fonte"] == "usuario"
                )
                if exists:
                    log.info("G18 mem: decisão usuário existe para %s, skip sistema", d.tipo)
                    continue
            did = str(uuid.uuid4())
            st["decisions"].append({
                "id": did, "tipo": d.tipo, "valor": d.valor,
                "justificativa": d.justificativa, "fonte": d.fonte.value,
                "fonte_mensagem_id": user_msg_id,
                "criado_em": datetime.now(timezone.utc).isoformat(),
            })
            decision_ids.append(did)

        # 7) checklist updates
        updated_keys: list[str] = []
        for upd in analysis.checklist_updates:
            seed = ce.get_seed_item(upd.item_key)
            if seed is None or seed["owner"] == "orgao":
                continue
            it = st["checklist"].get(upd.item_key)
            if it is None:
                continue
            it.status = upd.status
            if upd.valor is not None:
                it.valor = upd.valor
            if upd.justificativa:
                it.justificativa = upd.justificativa
            it.atualizado_em = datetime.now(timezone.utc)
            updated_keys.append(upd.item_key)

        return {
            "user_message_id": user_msg_id,
            "assistant_message_id": assistant_msg_id,
            "analysis": analysis.model_dump(),
            "persisted": {
                "facts": fact_ids,
                "decisions": decision_ids,
                "checklist_keys": updated_keys,
            },
        }

    async def stream_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        import asyncio
        result = await self.handle_turn(
            contratacao_id=contratacao_id,
            user_message=user_message,
            anexos=anexos,
        )
        analysis = ConversationTurnAnalysis.model_validate(result["analysis"])
        text = analysis.user_response
        chunk = 24
        for i in range(0, len(text), chunk):
            yield "assistant_token", {"text": text[i:i + chunk]}
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
                "sources": [p.model_dump() for p in analysis.price_sources_to_add]
            }
        yield "turn_complete", {
            "message_id": result["assistant_message_id"],
            "intent": analysis.intent.value,
            "next_best_question": analysis.next_best_question,
            "suggested_actions": [a.model_dump() for a in analysis.suggested_actions],
        }

    async def list_history(
        self, contratacao_id: str, limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[MensagemOut]:
        st = self._state(contratacao_id)
        msgs = list(st["mensagens"])
        if before:
            msgs = [m for m in msgs if m.criado_em < before]
        return msgs[-limit:]

    async def get_checklist(self, contratacao_id: str) -> ChecklistResponse:
        await self.ensure_seed(contratacao_id)
        st = self._state(contratacao_id)
        items = list(st["checklist"].values())
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

    async def patch_checklist_item(
        self,
        contratacao_id: str,
        item_key: str,
        *,
        status: ChecklistStatus,
        valor: Optional[Any] = None,
        justificativa: Optional[str] = None,
    ) -> Optional[ChecklistItem]:
        await self.ensure_seed(contratacao_id)
        st = self._state(contratacao_id)
        it = st["checklist"].get(item_key)
        if it is None:
            return None
        if status == ChecklistStatus.DISPENSADO and not justificativa:
            raise ValueError("Dispensar item exige justificativa.")
        it.status = status
        if valor is not None:
            it.valor = valor
        if justificativa:
            it.justificativa = justificativa
        it.atualizado_em = datetime.now(timezone.utc)
        return it

    # ── Sprint B: fontes ────────────────────────────────────────────────
    async def list_sources(self, contratacao_id: str) -> list[FonteUsuario]:
        st = self._state(contratacao_id)
        return sorted(
            st["fontes"].values(),
            key=lambda s: s.criado_em,
            reverse=True,
        )

    async def add_source(
        self, contratacao_id: str, payload: FonteUsuarioIn,
    ) -> FonteUsuario:
        from xerticaproc.backend.tools import price_workbench as pw

        st = self._state(contratacao_id)
        sid = uuid.uuid4()
        src = FonteUsuario(
            id=sid,
            contratacao_id=contratacao_id,
            tipo=payload.tipo,
            status=FonteUsuarioStatus.PENDENTE,
            url=payload.url,
            texto_colado=payload.texto_colado,
            arquivo_gcs_uri=payload.arquivo_gcs_uri,
            produto=payload.produto,
            observacao=payload.observacao,
            criado_em=datetime.now(timezone.utc),
        )
        st["fontes"][str(sid)] = src

        # Validação assíncrona em background (best-effort)
        async def _bg() -> None:
            try:
                updated = await pw.validate(src)
                st["fontes"][str(sid)] = updated
                log.info(
                    "fonte_validada id=%s status=%s class=%s score=%s",
                    sid, updated.status, updated.classificacao, updated.score,
                )
            except Exception:  # noqa: BLE001
                log.exception("Erro validando fonte %s", sid)
                src.status = FonteUsuarioStatus.DESCARTADA
                src.observacao = "Erro interno na validação"
                src.validado_em = datetime.now(timezone.utc)

        import asyncio
        asyncio.create_task(_bg())
        return src

    async def patch_source(
        self, contratacao_id: str, source_id: str, payload: FonteUsuarioPatch,
    ) -> Optional[FonteUsuario]:
        st = self._state(contratacao_id)
        src = st["fontes"].get(source_id)
        if src is None:
            return None
        if payload.classificacao is not None:
            src.classificacao = payload.classificacao
        if payload.status is not None:
            src.status = payload.status
        if payload.observacao is not None:
            src.observacao = payload.observacao
        return src

    async def list_negative_searches(
        self, contratacao_id: str,
    ) -> list[PesquisaNegativa]:
        st = self._state(contratacao_id)
        return list(st["pesquisas_negativas"])

    async def add_negative_search(
        self, contratacao_id: str, payload: PesquisaNegativaIn,
    ) -> PesquisaNegativa:
        st = self._state(contratacao_id)
        pn = PesquisaNegativa(
            id=uuid.uuid4(),
            contratacao_id=contratacao_id,
            criado_em=datetime.now(timezone.utc),
            **payload.model_dump(),
        )
        st["pesquisas_negativas"].append(pn)
        return pn

    # ── Sprint C: readiness + geração ──────────────────────────────────
    async def evaluate_readiness(
        self, contratacao_id: str, doc_type: str,
    ) -> DocumentReadiness:
        from xerticaproc.backend.agents import readiness_agent as ra
        checklist = await self.get_checklist(contratacao_id)
        return ra.evaluate(checklist, doc_type)

    async def generate_document(
        self, contratacao_id: str, doc_type: str,
    ) -> DocumentoGeradoLite:
        from xerticaproc.backend.tools import (
            etp_renderer, mapa_precos_renderer, tr_renderer,
        )
        readiness = await self.evaluate_readiness(contratacao_id, doc_type)
        if not readiness.can_generate:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "readiness_failed",
                    "readiness": readiness.model_dump(mode="json"),
                },
            )
        st = self._state(contratacao_id)
        checklist = await self.get_checklist(contratacao_id)
        fontes = list(st["fontes"].values())

        if doc_type == "etp":
            content_md = etp_renderer.render_etp_markdown(
                contratacao_id=contratacao_id,
                checklist=checklist,
                facts=st["facts"],
                decisions=st["decisions"],
                fontes=fontes,
            )
        elif doc_type == "tr":
            content_md = tr_renderer.render_tr_markdown(
                contratacao_id=contratacao_id,
                checklist=checklist,
                facts=st["facts"],
                decisions=st["decisions"],
                fontes=fontes,
            )
        elif doc_type == "mapa_precos":
            content_md = mapa_precos_renderer.render_mapa_precos_markdown(
                contratacao_id=contratacao_id,
                checklist=checklist,
                fontes=fontes,
                negativas=st["pesquisas_negativas"],
            )
        else:
            from fastapi import HTTPException
            raise HTTPException(400, f"doc_type {doc_type!r} desconhecido")

        prev = [d for d in st["documentos"] if d.doc_type == doc_type]
        doc = DocumentoGeradoLite(
            id=uuid.uuid4(),
            contratacao_id=contratacao_id,
            doc_type=doc_type,  # type: ignore[arg-type]
            versao=len(prev) + 1,
            content_md=content_md,
            readiness_snapshot=readiness,
            gerado_em=datetime.now(timezone.utc),
        )
        st["documentos"].append(doc)
        log.info(
            "documento_gerado cid=%s doc_type=%s versao=%s score=%s",
            contratacao_id, doc_type, doc.versao, readiness.score,
        )
        return doc

    async def list_documents(
        self, contratacao_id: str,
    ) -> list[DocumentoGeradoLite]:
        st = self._state(contratacao_id)
        return list(st["documentos"])

    # ── Sprint D: revisor + pacote de evidências ────────────────────────
    async def review_documents(self, contratacao_id: str):
        from xerticaproc.backend.agents import revisor_agent_v2 as rv
        st = self._state(contratacao_id)
        checklist = await self.get_checklist(contratacao_id)
        return rv.review(
            contratacao_id=contratacao_id,
            checklist=checklist,
            documentos=list(st["documentos"]),
            fontes=list(st["fontes"].values()),
            decisions=st["decisions"],
            facts=st["facts"],
            negativas=list(st["pesquisas_negativas"]),
        )

    async def build_evidence_pack(self, contratacao_id: str) -> bytes:
        import io, json, zipfile
        st = self._state(contratacao_id)
        checklist = await self.get_checklist(contratacao_id)
        review = await self.review_documents(contratacao_id)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for doc in st["documentos"]:
                fname = f"documentos/{doc.doc_type}-v{doc.versao}.md"
                zf.writestr(fname, doc.content_md)
            zf.writestr("checklist.json", checklist.model_dump_json(indent=2))
            zf.writestr(
                "fontes.json",
                json.dumps(
                    [f.model_dump(mode="json") for f in st["fontes"].values()],
                    indent=2, ensure_ascii=False,
                ),
            )
            zf.writestr(
                "facts.json",
                json.dumps(st["facts"], indent=2, ensure_ascii=False, default=str),
            )
            zf.writestr(
                "decisions.json",
                json.dumps(st["decisions"], indent=2, ensure_ascii=False, default=str),
            )
            zf.writestr(
                "pesquisas_negativas.json",
                json.dumps(
                    [n.model_dump(mode="json") for n in st["pesquisas_negativas"]],
                    indent=2, ensure_ascii=False,
                ),
            )
            zf.writestr("revisor.json", review.model_dump_json(indent=2))
            zf.writestr(
                "README.md",
                f"# Pacote de evidências — {contratacao_id}\n\n"
                f"Gerado em {datetime.now(timezone.utc).isoformat()}.\n\n"
                f"- {len(st['documentos'])} documento(s)\n"
                f"- {len(st['fontes'])} fonte(s)\n"
                f"- {len(st['facts'])} fato(s)\n"
                f"- {len(st['decisions'])} decisão(ões)\n"
                f"- {len(st['pesquisas_negativas'])} busca(s) negativa(s)\n"
                f"- Revisor: {review.summary}\n",
            )
        return buf.getvalue()

    # ── Sprint D extra: aprovações + eventos (in-memory) ────────────────
    async def add_aprovacao(self, contratacao_id, documento_id, payload):
        from xerticaproc.backend.models.copilot_schemas import Aprovacao
        st = self._state(contratacao_id)
        ap = Aprovacao(
            id=uuid.uuid4(), contratacao_id=contratacao_id,
            documento_id=UUID(documento_id), criado_em=datetime.now(timezone.utc),
            **payload.model_dump(),
        )
        st["aprovacoes"].append(ap)
        st["eventos"].append({
            "id": uuid.uuid4(), "contratacao_id": contratacao_id,
            "tipo": f"aprovacao.{ap.decisao}",
            "payload": {"documento_id": documento_id, "aprovado_por": ap.aprovado_por},
            "lido": False, "criado_em": datetime.now(timezone.utc),
        })
        return ap

    async def list_aprovacoes(self, contratacao_id):
        return list(self._state(contratacao_id)["aprovacoes"])

    async def list_eventos(self, contratacao_id, *, only_unread=False, limit=50):
        from xerticaproc.backend.models.copilot_schemas import EventoOut
        st = self._state(contratacao_id)
        evs = st["eventos"]
        if only_unread:
            evs = [e for e in evs if not e["lido"]]
        evs = sorted(evs, key=lambda e: e["criado_em"], reverse=True)[:limit]
        return [EventoOut(**e) for e in evs]

    async def mark_eventos_read(self, contratacao_id):
        st = self._state(contratacao_id)
        n = 0
        for e in st["eventos"]:
            if not e["lido"]:
                e["lido"] = True
                n += 1
        return n


# ─────────────────────────────────────────────────────────────────────────────
# Postgres backend (produção)

class PostgresCopilotBackend:
    async def _ensure_contratacao_exists(self, contratacao_id: str) -> None:
        from sqlalchemy import text
        from xerticaproc.backend.tools.pg_tools import buscar_contratacao, get_session
        async with get_session() as s:
            row = await buscar_contratacao(s, contratacao_id)
            if row is not None:
                return
            # Backward compatibility: contratos criados em memória em revisões
            # anteriores não existiam no Postgres e quebravam o Copiloto.
            await s.execute(
                text(
                    """
                    INSERT INTO contratacoes
                      (id, id_orgao, nome_orgao, objeto_resumido,
                       descricao_necessidade, prazo_vigencia_meses, palavras_chave)
                    VALUES
                      (CAST(:id AS uuid), :id_orgao, :nome_orgao, :objeto_resumido,
                       :descricao_necessidade, :prazo_vigencia_meses,
                       CAST(:palavras_chave AS text[]))
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": contratacao_id,
                    "id_orgao": "na",
                    "nome_orgao": "Órgão não informado",
                    "objeto_resumido": "Objeto em definição",
                    "descricao_necessidade": "Demanda inicial registrada via Copiloto",
                    "prazo_vigencia_meses": 12,
                    "palavras_chave": [],
                },
            )
        log.warning("copilot.bootstrap_contratacao cid=%s", contratacao_id)

    async def ensure_seed(self, contratacao_id: str) -> None:
        from xerticaproc.backend.tools.pg_tools import get_session
        await self._ensure_contratacao_exists(contratacao_id)
        async with get_session() as s:
            items = await ce.list_items(s, contratacao_id)
            if not items:
                await ce.seed_checklist(s, contratacao_id)

    async def handle_turn(
        self, *, contratacao_id: str, user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> dict[str, Any]:
        from xerticaproc.backend.agents.conversation_orchestrator import handle_turn
        from xerticaproc.backend.tools.pg_tools import get_session
        await self._ensure_contratacao_exists(contratacao_id)
        async with get_session() as s:
            return await handle_turn(
                s, contratacao_id=contratacao_id,
                user_message=user_message, anexos=anexos,
            )

    async def stream_turn(
        self, *, contratacao_id: str, user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        from xerticaproc.backend.agents.conversation_orchestrator import (
            handle_turn_stream,
        )
        from xerticaproc.backend.tools.pg_tools import get_session
        await self._ensure_contratacao_exists(contratacao_id)
        async with get_session() as s:
            async for ev, data in handle_turn_stream(
                s, contratacao_id=contratacao_id,
                user_message=user_message, anexos=anexos,
            ):
                yield ev, data

    async def list_history(
        self, contratacao_id: str, limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[MensagemOut]:
        from xerticaproc.backend.tools import conversation_store as cs
        from xerticaproc.backend.tools.pg_tools import get_session
        await self._ensure_contratacao_exists(contratacao_id)
        async with get_session() as s:
            return await cs.list_messages(s, contratacao_id, limit=limit, before=before)

    async def get_checklist(self, contratacao_id: str) -> ChecklistResponse:
        from xerticaproc.backend.tools.pg_tools import get_session
        await self._ensure_contratacao_exists(contratacao_id)
        async with get_session() as s:
            items = await ce.list_items(s, contratacao_id)
            if not items:
                await ce.seed_checklist(s, contratacao_id)
            return await ce.get_response(s, contratacao_id)

    async def patch_checklist_item(
        self, contratacao_id: str, item_key: str, *,
        status: ChecklistStatus,
        valor: Optional[Any] = None,
        justificativa: Optional[str] = None,
    ) -> Optional[ChecklistItem]:
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await ce.update_item(
                s, contratacao_id, item_key,
                status=status, valor=valor, justificativa=justificativa,
                allow_orgao_override=True,  # PATCH explícito do usuário pode override
            )

    # ── Sprint B: fontes (Postgres) ─────────────────────────────────────
    async def list_sources(self, contratacao_id: str) -> list[FonteUsuario]:
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.list_sources(s, contratacao_id)

    async def add_source(
        self, contratacao_id: str, payload: FonteUsuarioIn,
    ) -> FonteUsuario:
        import asyncio
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools import price_workbench as pw
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            src = await cs2.insert_source(s, contratacao_id, payload)

        async def _bg() -> None:
            try:
                updated = await pw.validate(src)
                async with get_session() as s2:
                    await cs2.update_source_validation(s2, updated)
                    if updated.status == FonteUsuarioStatus.VALIDADA:
                        await cs2.emit_event(
                            s2, contratacao_id,
                            tipo="fonte_validada",
                            payload={
                                "fonte_id": str(src.id),
                                "classificacao": updated.classificacao.value
                                if updated.classificacao else None,
                            },
                        )
            except Exception:
                log.exception("Erro validando fonte %s (pg)", src.id)
        asyncio.create_task(_bg())
        return src

    async def patch_source(
        self, contratacao_id: str, source_id: str, payload: FonteUsuarioPatch,
    ) -> Optional[FonteUsuario]:
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.patch_source(s, contratacao_id, source_id, payload)

    async def list_negative_searches(
        self, contratacao_id: str,
    ) -> list[PesquisaNegativa]:
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.list_negative_searches(s, contratacao_id)

    async def add_negative_search(
        self, contratacao_id: str, payload: PesquisaNegativaIn,
    ) -> PesquisaNegativa:
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.insert_negative_search(s, contratacao_id, payload)

    # ── Sprint C: readiness + geração persistente ──────────────────────
    async def evaluate_readiness(
        self, contratacao_id: str, doc_type: str,
    ) -> DocumentReadiness:
        from xerticaproc.backend.agents import readiness_agent as ra
        checklist = await self.get_checklist(contratacao_id)
        return ra.evaluate(checklist, doc_type)

    async def generate_document(
        self, contratacao_id: str, doc_type: str,
    ) -> DocumentoGeradoLite:
        from xerticaproc.backend.tools import (
            copilot_store_v2 as cs2,
            etp_renderer, mapa_precos_renderer, tr_renderer,
        )
        from xerticaproc.backend.tools.pg_tools import get_session

        readiness = await self.evaluate_readiness(contratacao_id, doc_type)
        if not readiness.can_generate:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "readiness_failed",
                    "readiness": readiness.model_dump(mode="json"),
                },
            )
        checklist = await self.get_checklist(contratacao_id)
        async with get_session() as s:
            fontes = await cs2.list_sources(s, contratacao_id)
            negativas = await cs2.list_negative_searches(s, contratacao_id)

        # Facts/decisions: extrair do checklist (snapshot leve)
        facts = [
            {"tipo": it.item_key, "valor": it.valor}
            for cat in checklist.by_category.values()
            for it in cat
            if it.valor is not None
        ]
        decisions: list[dict] = []

        if doc_type == "etp":
            content_md = etp_renderer.render_etp_markdown(
                contratacao_id=contratacao_id, checklist=checklist,
                facts=facts, decisions=decisions, fontes=fontes,
            )
        elif doc_type == "tr":
            content_md = tr_renderer.render_tr_markdown(
                contratacao_id=contratacao_id, checklist=checklist,
                facts=facts, decisions=decisions, fontes=fontes,
            )
        elif doc_type == "mapa_precos":
            content_md = mapa_precos_renderer.render_mapa_precos_markdown(
                contratacao_id=contratacao_id, checklist=checklist,
                fontes=fontes, negativas=negativas,
            )
        else:
            from fastapi import HTTPException
            raise HTTPException(400, f"doc_type {doc_type!r} desconhecido")

        async with get_session() as s:
            doc = await cs2.insert_documento(
                s, contratacao_id, doc_type, content_md, readiness,
            )
        log.info(
            "documento_gerado_pg cid=%s doc_type=%s versao=%s score=%s",
            contratacao_id, doc_type, doc.versao, readiness.score,
        )
        return doc

    async def list_documents(
        self, contratacao_id: str,
    ) -> list[DocumentoGeradoLite]:
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.list_documentos(s, contratacao_id)

    async def review_documents(self, contratacao_id: str):
        from xerticaproc.backend.agents import revisor_agent_v2 as rv
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        checklist = await self.get_checklist(contratacao_id)
        async with get_session() as s:
            documentos = await cs2.list_documentos(s, contratacao_id)
            fontes = await cs2.list_sources(s, contratacao_id)
            negativas = await cs2.list_negative_searches(s, contratacao_id)
        return rv.review(
            contratacao_id=contratacao_id, checklist=checklist,
            documentos=documentos, fontes=fontes,
            decisions=[], facts=[], negativas=negativas,
        )

    async def build_evidence_pack(self, contratacao_id: str) -> bytes:
        import io, json, zipfile
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        checklist = await self.get_checklist(contratacao_id)
        review = await self.review_documents(contratacao_id)
        async with get_session() as s:
            documentos = await cs2.list_documentos(s, contratacao_id)
            fontes = await cs2.list_sources(s, contratacao_id)
            negativas = await cs2.list_negative_searches(s, contratacao_id)
            aprovacoes = await cs2.list_aprovacoes(s, contratacao_id)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for doc in documentos:
                zf.writestr(
                    f"documentos/{doc.doc_type}-v{doc.versao}.md",
                    doc.content_md,
                )
            zf.writestr("checklist.json", checklist.model_dump_json(indent=2))
            zf.writestr(
                "fontes.json",
                json.dumps(
                    [f.model_dump(mode="json") for f in fontes],
                    indent=2, ensure_ascii=False,
                ),
            )
            zf.writestr(
                "pesquisas_negativas.json",
                json.dumps(
                    [n.model_dump(mode="json") for n in negativas],
                    indent=2, ensure_ascii=False,
                ),
            )
            zf.writestr(
                "aprovacoes.json",
                json.dumps(
                    [a.model_dump(mode="json") for a in aprovacoes],
                    indent=2, ensure_ascii=False,
                ),
            )
            zf.writestr("revisor.json", review.model_dump_json(indent=2))
            zf.writestr(
                "README.md",
                f"# Pacote de evidências — {contratacao_id}\n\n"
                f"Gerado em {datetime.now(timezone.utc).isoformat()}.\n\n"
                f"- {len(documentos)} documento(s)\n"
                f"- {len(fontes)} fonte(s)\n"
                f"- {len(negativas)} busca(s) negativa(s)\n"
                f"- {len(aprovacoes)} aprovação(ões)\n"
                f"- Revisor: {review.summary}\n",
            )
        return buf.getvalue()

    # ── Sprint D extra: aprovações + eventos (Postgres) ─────────────────
    async def add_aprovacao(
        self, contratacao_id: str, documento_id: str, payload,
    ):
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.insert_aprovacao(s, contratacao_id, documento_id, payload)

    async def list_aprovacoes(self, contratacao_id: str):
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.list_aprovacoes(s, contratacao_id)

    async def list_eventos(self, contratacao_id: str, *, only_unread: bool = False, limit: int = 50):
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.list_eventos(s, contratacao_id, only_unread=only_unread, limit=limit)

    async def mark_eventos_read(self, contratacao_id: str) -> int:
        from xerticaproc.backend.tools import copilot_store_v2 as cs2
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs2.mark_eventos_read(s, contratacao_id)


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────

_backend: Optional[CopilotBackend] = None


def get_backend() -> CopilotBackend:
    global _backend
    if _backend is None:
        if os.environ.get("ALLOYDB_URL"):
            log.info("CopilotBackend: PostgresCopilotBackend (ALLOYDB_URL set)")
            _backend = PostgresCopilotBackend()
        else:
            log.info("CopilotBackend: InMemoryCopilotBackend (dev mode)")
            _backend = InMemoryCopilotBackend()
    return _backend
