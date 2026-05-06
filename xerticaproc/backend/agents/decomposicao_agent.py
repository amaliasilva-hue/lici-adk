"""Agente 2 — Decomposição do Objeto.

Recebe a DemandaEstruturada e transforma a demanda genérica em itens
contratáveis distintos, com alertas de direcionamento e sugestão de modalidade.

Modelo: Gemini 2.5 Flash (mais rápido, suficiente para decomposição)
"""
from __future__ import annotations

import json
import logging
import os

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.models.schemas import (
    DemandaEstruturada,
    ItemContratavel,
    ModalidadeContratacao,
    NivelRisco,
    ObjetoDecomposto,
    UnidadeMedida,
)

log = logging.getLogger("xerticaproc.agents.decomposicao")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente de Decomposição do Objeto da plataforma xerticaproc.

Sua função é transformar uma demanda genérica em itens contratáveis distintos, seguindo
a Lei nº 14.133/2021 e as boas práticas da IN SGD/ME nº 94/2022.

Regras:
1. Separar SEMPRE: licença de uso / créditos de nuvem / serviços técnicos / suporte / treinamento / sustentação / integrações
2. Alertar sobre RISCO DE DIRECIONAMENTO quando a descrição menciona marca, tecnologia proprietária exclusiva ou requisito desnecessariamente restritivo
3. Alertar sobre item sem preço público verificável (ex: solução customizada sem análogo no mercado)
4. Modalidade: sugerir com base no valor estimado e natureza do objeto
   - Serviços de TI padronizados → pregão eletrônico
   - Solução exclusiva, único fornecedor técnico → inexigibilidade (só se realmente aplicável)
   - Valor < R$ 59.906,25 (2024) → dispensa de licitação
5. Itens devem ter unidade de medida compatível com o mercado
6. Retorne APENAS JSON válido — sem texto adicional."""


def decompor_objeto(demanda: DemandaEstruturada, quantidades: dict | None = None) -> ObjetoDecomposto:
    """Decompõe a demanda em itens contratáveis via Gemini Flash."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(
            temperature=0.1,
            response_mime_type="application/json",
        ),
    )

    prompt = f"""
Demanda estruturada:
- Problema público: {demanda.problema_publico}
- Objetivo: {demanda.objetivo_contratacao}
- Resultados esperados: {json.dumps(demanda.resultados_esperados, ensure_ascii=False)}
- Restrições: {json.dumps(demanda.restricoes, ensure_ascii=False)}
- Premissas: {json.dumps(demanda.premissas, ensure_ascii=False)}
{f'- Quantidades estimadas: {json.dumps(quantidades, ensure_ascii=False)}' if quantidades else ''}

Decompor em itens contratáveis. Para cada item fornecer:
  - nome: string
  - descricao: string detalhada
  - tipo: "licenca" | "servico" | "suporte" | "treinamento" | "credito_nuvem" | "implantacao" | "sustentacao" | "integracao" | "governanca"
  - unidade_medida: "usuario" | "licenca" | "ust" | "hora_tecnica" | "credito_nuvem" | "pacote" | "item" | "servico" | "mes" | "ano" | "outro"
  - quantidade_estimada: número ou null
  - obrigatorio: true/false
  - alerta_direcionamento: string ou null
  - catmat: código CATMAT ou null
  - catser: código CATSER ou null

Saída JSON:
{{
  "objeto_consolidado": "string",
  "itens": [...],
  "modalidade_sugerida": "pregao_eletronico" | "concorrencia" | "dispensa" | "inexigibilidade" | "adesao_ata" | "arp",
  "alertas": ["..."],
  "risco_direcionamento": "alto" | "medio" | "baixo",
  "justificativa_modalidade": "string"
}}
"""

    log.info("agente_decomposicao.start")
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    result = ObjetoDecomposto.model_validate_json(raw)
    log.info("agente_decomposicao.done", extra={"n_itens": len(result.itens), "risco": result.risco_direcionamento})
    return result
