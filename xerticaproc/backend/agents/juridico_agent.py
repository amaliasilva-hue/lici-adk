"""Agente 6 — Jurídico/Normativo.

Valida aderência à:
  - Lei nº 14.133/2021
  - IN SGD/ME nº 94/2022
  - LGPD (Lei nº 13.709/2018)
  - Marco Civil da Internet (quando aplicável)
  - Súmulas do TCU relevantes

Usa RAG sobre base normativa indexada no AlloyDB (pgvector).
Modelo: Gemini 2.5 Pro (raciocínio jurídico exige modelo mais capaz)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.models.schemas import (
    DemandaEstruturada,
    ItemChecklistJuridico,
    ObjetoDecomposto,
    RequisitosTecnicos,
    ValidacaoJuridica,
)

log = logging.getLogger("xerticaproc.agents.juridico")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente Jurídico/Normativo da plataforma xerticaproc.

Responsabilidade: validar a aderência da contratação às normas aplicáveis.

Normas principais:
1. Lei nº 14.133/2021 — Nova Lei de Licitações e Contratos
2. IN SGD/ME nº 94/2022 — Contratações de Soluções de TIC
3. Lei nº 13.709/2018 — LGPD
4. Lei nº 12.965/2014 — Marco Civil da Internet (quando envolve internet/dados)
5. Súmulas TCU relevantes para TIC

Checklist obrigatório conforme IN 94/2022:
- DFD aprovado pela autoridade competente
- ETP com todos os elementos do art. 18 da IN 94
- TR com todos os elementos do art. 24 da IN 94
- Pesquisa de preços com mínimo de 3 referências ou justificativa
- Especificações sem restrição de marcas (art. 40 Lei 14.133)
- Critérios de habilitação proporcionais
- Modelo de execução e gestão definidos
- SLA mensurável e verificável
- LGPD: DPA se houver tratamento de dados pessoais
- LGPD: Encarregado de Dados (DPO) identificado
- Sustentabilidade ambiental (quando aplicável)

Alertas de risco de impugnação:
- Especificação de marca sem justificativa técnica
- Prazo de habilitação impossível para PMEs
- SLA acima do histórico do mercado sem justificativa
- Critérios de aceite não mensuráveis
- Volume exigido sem fonte verificável

Retorne APENAS JSON válido."""


def validar_juridico(
    demanda: DemandaEstruturada,
    objeto: ObjetoDecomposto,
    requisitos: RequisitosTecnicos,
    normas_rag: list[dict[str, Any]] | None = None,
) -> ValidacaoJuridica:
    """Valida conformidade jurídica via Gemini Pro."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(temperature=0.1, response_mime_type="application/json"),
    )

    normas_contexto = ""
    if normas_rag:
        normas_contexto = "\n\nTrechos normativos relevantes recuperados:\n" + "\n".join(
            f"[{n.get('tipo', '')} - {n.get('artigo', '')}]: {n.get('trecho', '')}"
            for n in normas_rag[:10]
        )

    ha_dados_pessoais = any(
        keyword in demanda.problema_publico.lower() + demanda.objetivo_contratacao.lower()
        for keyword in ["dado pessoal", "dados pessoais", "usuário", "cidadão", "servidor"]
    )

    alerta_marca = any(it.alerta_direcionamento for it in objeto.itens)

    prompt = f"""
Contratação a validar:

Objeto: {objeto.objeto_consolidado}
Modalidade sugerida: {objeto.modalidade_sugerida.value}
Itens: {json.dumps([{"nome": it.nome, "tipo": it.tipo} for it in objeto.itens], ensure_ascii=False)}

Restrições identificadas: {json.dumps(demanda.restricoes, ensure_ascii=False)}
Envolve dados pessoais: {'sim — LGPD aplicável' if ha_dados_pessoais else 'não confirmado — verificar'}
Alerta de marca/direcionamento já detectado: {'SIM — verificar requisitos técnicos' if alerta_marca else 'não'}

Alertas de especificação excessiva: {json.dumps(requisitos.alertas_especificacao_excessiva, ensure_ascii=False)}
SLA proposto: {json.dumps(requisitos.niveis_servico, ensure_ascii=False)}
Certificações exigidas: {json.dumps([r for r in requisitos.requisitos_seguranca if 'iso' in r.lower() or 'soc' in r.lower() or 'pci' in r.lower()], ensure_ascii=False)}
{normas_contexto}

Gere ValidacaoJuridica JSON:
{{
  "checklist": [
    {{
      "item": "ETP contém todos os elementos do art. 18 da IN 94/2022",
      "conforme": true,
      "observacao": null,
      "artigo_referencia": "art. 18 IN SGD/ME nº 94/2022"
    }},
    ...
  ],
  "aderente_lei_14133": true,
  "aderente_in_94_2022": true,
  "aderente_lgpd": true,
  "pendencias": [],
  "alertas_impugnacao": [],
  "recomendacoes": [],
  "referencias_normativas": ["art. 40 Lei nº 14.133/2021", ...]
}}
"""

    log.info("agente_juridico.start")
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    result = ValidacaoJuridica.model_validate_json(raw)
    log.info(
        "agente_juridico.done",
        extra={
            "aderente": result.aderente_lei_14133 and result.aderente_in_94_2022,
            "pendencias": len(result.pendencias),
            "alertas_impugnacao": len(result.alertas_impugnacao),
        },
    )
    return result
