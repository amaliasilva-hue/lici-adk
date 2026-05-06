"""Agente 1 — Demanda / DFD.

Responsável por estruturar a necessidade da contratação a partir da conversa
com o usuário e documentos anexados (DFD, e-mails, atas, histórico).

Entrada:
  EntradaDemanda + documentos opcionais (bytes de PDF)

Saída:
  DemandaEstruturada

Modelo: Gemini 2.5 Pro (análise profunda de contexto)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import vertexai
from vertexai.generative_models import (
    GenerativeModel,
    GenerationConfig,
    Part,
)

from xerticaproc.backend.models.schemas import DemandaEstruturada, EntradaDemanda

log = logging.getLogger("xerticaproc.agents.demanda")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente de Demanda da plataforma xerticaproc — um sistema de inteligência \
para elaboração de ETP (Estudo Técnico Preliminar) e TR (Termo de Referência) conforme \
a Lei nº 14.133/2021 e a IN SGD/ME nº 94/2022.

Sua função é estruturar a DEMANDA da contratação com base nas informações fornecidas pelo usuário.

Regras absolutas:
1. Não invente requisitos, necessidades ou restrições que não foram mencionados.
2. Se uma informação está ausente, registre como "pendência" no campo perguntas_pendentes.
3. O problema público deve ser concreto e verificável — não genérico.
4. O objetivo deve ser específico e mensurável.
5. Alinhamento PCA/PDTIC só pode ser afirmado se o usuário informou explicitamente.

Retorne APENAS um JSON válido no formato DemandaEstruturada. Sem texto adicional."""


def estruturar_demanda(
    entrada: EntradaDemanda,
    documentos_pdf: list[bytes] | None = None,
) -> DemandaEstruturada:
    """Processa a entrada do usuário e estrutura a demanda via Gemini Pro."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(
            temperature=0.2,
            response_mime_type="application/json",
        ),
    )

    # Monta o prompt com os dados estruturados
    usuario_msg = f"""
Dados da contratação informados pelo usuário:

Órgão: {entrada.orgao}
UASG: {entrada.uasg or 'não informado'}
Unidade demandante: {entrada.unidade_demandante}
Objeto: {entrada.objeto_da_contratacao}
Problema público: {entrada.problema_publico}
Objetivo: {entrada.objetivo}
Prazo estimado: {entrada.prazo_estimado_meses} meses
Orçamento estimado: {f'R$ {entrada.orcamento_estimado:,.2f}' if entrada.orcamento_estimado else 'não informado'}
PCA alinhado: {entrada.pca_id or 'não informado'}
PDTIC alinhado: {'sim' if entrada.pdtic_alinhado else 'não confirmado'}
Contrato atual: {entrada.contrato_atual or 'não há contrato vigente'}
Envolve dados pessoais (LGPD): {'sim' if entrada.ha_dados_pessoais else 'não'}
Requer integração: {'sim' if entrada.ha_integracao_sistemas else 'não'}
Restrições: {json.dumps(entrada.restricoes, ensure_ascii=False)}
Premissas: {json.dumps(entrada.premissas, ensure_ascii=False)}
Dependências: {json.dumps(entrada.dependencias, ensure_ascii=False)}
Requisitos técnicos iniciais: {entrada.requisitos_tecnicos_iniciais or 'não informados'}
Quantidades: {json.dumps(entrada.quantidades, ensure_ascii=False)}

Com base nessas informações, gere um JSON DemandaEstruturada com os campos:
- problema_publico: string concisa e verificável
- objetivo_contratacao: string específica e mensurável
- unidade_demandante: string
- resultados_esperados: lista de strings (outcomes, não outputs)
- restricoes: lista de strings
- premissas: lista de strings
- dependencias: lista de strings
- alinhamento_pca: string ou null
- alinhamento_pdtic: string ou null
- perguntas_pendentes: lista de strings (informações que faltam)
- lacunas_identificadas: lista de strings (pontos que precisam de esclarecimento)
- diagnostico: texto resumido da situação atual e justificativa da necessidade
"""

    parts: list[Any] = [usuario_msg]

    # Adiciona documentos PDF se fornecidos
    if documentos_pdf:
        for i, pdf_bytes in enumerate(documentos_pdf[:3]):  # máximo 3 docs
            parts.append(Part.from_data(data=pdf_bytes, mime_type="application/pdf"))
            parts.append(f"[Documento {i+1} acima]")

    log.info("agente_demanda.start", extra={"orgao": entrada.orgao, "objeto": entrada.objeto_da_contratacao[:80]})

    response = model.generate_content(parts)
    raw_json = response.text.strip()

    if raw_json.startswith("```"):
        raw_json = raw_json.split("```")[1]
        if raw_json.startswith("json"):
            raw_json = raw_json[4:]

    result = DemandaEstruturada.model_validate_json(raw_json)
    log.info(
        "agente_demanda.done",
        extra={"pendencias": len(result.perguntas_pendentes), "lacunas": len(result.lacunas_identificadas)},
    )
    return result
