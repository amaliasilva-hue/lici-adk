"""Agente 5 — Requisitos Técnicos.

Gera os requisitos técnicos suficientes (funcionais, não-funcionais,
segurança, integração, SLA) sem exagerar em especificações que restrinjam
a competição ou favoreçam fornecedor específico.

Modelo: Gemini 2.5 Flash
"""
from __future__ import annotations

import json
import logging
import os

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.models.schemas import (
    DemandaEstruturada,
    MatrizAlternativas,
    ObjetoDecomposto,
    RequisitosTecnicos,
)

log = logging.getLogger("xerticaproc.agents.tecnico")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente Técnico da plataforma xerticaproc.

Responsabilidade: gerar os REQUISITOS TÉCNICOS da contratação — funcionais e não-funcionais —
de forma suficiente, sem especificação excessiva que restrinja a competição.

Princípios obrigatórios (Lei nº 14.133/2021):
1. Requisitos devem ser baseados em NECESSIDADE REAL, não em preferência de produto
2. Nunca citar marca, modelo ou fornecedor específico sem justificativa técnica obrigatória
3. Requisitos de certificação (ISO, SOC) só se justificados pela natureza dos dados
4. SLA deve ser realista para o mercado — não criar SLA impossível para excluir concorrentes
5. Critérios de aceite DEVEM ser mensuráveis e verificáveis
6. Se um requisito for potencialmente restritivo → alertar em alertas_especificacao_excessiva
7. Requisitos de LGPD obrigatórios quando há dados pessoais

Retorne APENAS JSON válido."""


def gerar_requisitos_tecnicos(
    demanda: DemandaEstruturada,
    objeto: ObjetoDecomposto,
    alternativa_escolhida: MatrizAlternativas | None = None,
) -> RequisitosTecnicos:
    """Gera requisitos técnicos via Gemini Flash."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(temperature=0.15, response_mime_type="application/json"),
    )

    contexto_alternativa = ""
    if alternativa_escolhida:
        contexto_alternativa = f"\nAlternativa escolhida: {alternativa_escolhida.alternativa_escolhida}\nJustificativa: {alternativa_escolhida.justificativa_escolha}"

    prompt = f"""
Demanda:
- Problema público: {demanda.problema_publico}
- Objetivo: {demanda.objetivo_contratacao}
- Resultados esperados: {json.dumps(demanda.resultados_esperados, ensure_ascii=False)}
- Envolve dados pessoais: {'sim' if any('lgpd' in r.lower() or 'dado' in r.lower() or 'pessoal' in r.lower() for r in demanda.restricoes) else 'avaliar'}
- Restrições: {json.dumps(demanda.restricoes, ensure_ascii=False)}
{contexto_alternativa}

Itens contratáveis:
{json.dumps([{"nome": it.nome, "tipo": it.tipo, "unidade": it.unidade_medida.value} for it in objeto.itens], ensure_ascii=False)}

Gere RequisitosTecnicos JSON:
{{
  "requisitos_funcionais": ["O sistema deve ...", ...],
  "requisitos_nao_funcionais": ["Disponibilidade mínima de 99,5%", ...],
  "requisitos_seguranca": ["Dados criptografados em repouso (AES-256)", ...],
  "requisitos_integracao": ["API REST para integração com ...", ...],
  "requisitos_suporte": ["Suporte em português no horário comercial (8h-18h, dias úteis)", ...],
  "niveis_servico": {{
    "disponibilidade": "99,5% mensal",
    "RTO": "4 horas",
    "RPO": "24 horas",
    "tempo_resposta_suporte_critico": "2 horas úteis"
  }},
  "criterios_aceite": ["Disponibilidade verificada via relatório mensal", ...],
  "requisitos_lgpd": ["DPA (Data Processing Agreement) obrigatório", ...],
  "alertas_especificacao_excessiva": []
}}
"""

    log.info("agente_tecnico.start")
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    result = RequisitosTecnicos.model_validate_json(raw)
    log.info(
        "agente_tecnico.done",
        extra={"n_funcionais": len(result.requisitos_funcionais), "alertas": len(result.alertas_especificacao_excessiva)},
    )
    return result
