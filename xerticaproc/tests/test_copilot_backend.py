"""Testes do PostgresCopilotBackend usando SQLite async (drop-in p/ pg).

Como a sintaxe `:json::jsonb` é específica do Postgres, os testes
focam no fluxo InMemory que tem paridade funcional.
"""
from __future__ import annotations

import uuid
import pytest

from xerticaproc.backend.copilot_backend import InMemoryCopilotBackend
from xerticaproc.backend.models.copilot_schemas import (
    AprovacaoIn,
    ChecklistStatus,
    FonteUsuarioIn,
    PesquisaNegativaIn,
)


@pytest.fixture
def backend() -> InMemoryCopilotBackend:
    return InMemoryCopilotBackend()


@pytest.fixture
def cid() -> str:
    return f"test-{uuid.uuid4().hex[:8]}"


@pytest.mark.asyncio
async def test_seed_creates_checklist(backend, cid):
    await backend.ensure_seed(cid)
    cl = await backend.get_checklist(cid)
    assert cl.summary.total > 0
    assert cl.summary.pendente > 0


@pytest.mark.asyncio
async def test_add_source_returns_pending(backend, cid):
    await backend.ensure_seed(cid)
    src = await backend.add_source(
        cid, FonteUsuarioIn(tipo="texto_colado", texto_colado="R$ 12.000,00 — 10 unidades — 12 meses"),
    )
    assert src.id is not None
    sources = await backend.list_sources(cid)
    assert len(sources) == 1


@pytest.mark.asyncio
async def test_negative_search(backend, cid):
    await backend.ensure_seed(cid)
    pn = await backend.add_negative_search(
        cid, PesquisaNegativaIn(termo="X", fontes_consultadas=["PNCP"]),
    )
    assert pn.id is not None
    items = await backend.list_negative_searches(cid)
    assert items[0].termo == "X"


@pytest.mark.asyncio
async def test_aprovacao_emits_event(backend, cid):
    await backend.ensure_seed(cid)
    fake_doc = str(uuid.uuid4())
    ap = await backend.add_aprovacao(
        cid, fake_doc,
        AprovacaoIn(aprovado_por="Ana", papel="Gestor", decisao="aprovado"),
    )
    assert ap.decisao == "aprovado"
    evs = await backend.list_eventos(cid)
    assert any(e.tipo == "aprovacao.aprovado" for e in evs)
    n = await backend.mark_eventos_read(cid)
    assert n >= 1
    unread = await backend.list_eventos(cid, only_unread=True)
    assert len(unread) == 0


@pytest.mark.asyncio
async def test_workflow_evaluation():
    from xerticaproc.backend.agents.approval_workflow import evaluate_workflow
    from datetime import datetime, timezone
    from uuid import uuid4

    def _ap(papel: str, decisao: str):
        return AprovacaoIn(aprovado_por="X", papel=papel, decisao=decisao).model_copy(
            update={},  # apenas para coerção de tipo
        )

    # Constrói Aprovacao via dict para evitar import circular pesado
    from xerticaproc.backend.models.copilot_schemas import Aprovacao
    cid = "c1"
    did = uuid4()

    def make(papel, decisao):
        return Aprovacao(
            id=uuid4(), contratacao_id=cid, documento_id=did,
            aprovado_por="X", papel=papel, decisao=decisao,
            criado_em=datetime.now(timezone.utc),
        )

    # ETP precisa de Gestor + Demanda
    res = evaluate_workflow("etp", [make("Gestor", "aprovado")])
    assert res["status"] == "parcial"
    res = evaluate_workflow("etp", [make("Gestor", "aprovado"), make("Demanda", "aprovado")])
    assert res["status"] == "aprovado"
    res = evaluate_workflow("etp", [make("Gestor", "rejeitado")])
    assert res["status"] == "rejeitado"


@pytest.mark.asyncio
async def test_checklist_patch(backend, cid):
    await backend.ensure_seed(cid)
    cl = await backend.get_checklist(cid)
    first_key = next(iter(cl.by_category.values()))[0].item_key
    item = await backend.patch_checklist_item(
        cid, first_key, status=ChecklistStatus.CONFIRMADO, valor="ok",
    )
    assert item is not None
    assert item.status == ChecklistStatus.CONFIRMADO
