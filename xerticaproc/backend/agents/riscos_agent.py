"""Agente 7 — Riscos.

Gera a Matriz de Riscos da contratação considerando:
  - Risco de preço inexequível
  - Baixa comparabilidade de fontes
  - Lock-in de fornecedor
  - Dependência tecnológica
  - Privacidade (LGPD)
  - Impugnação por direcionamento
  - Indisponibilidade
  - Integração
  - Consumo sem controle (nuvem)

Modelo: Gemini 2.5 Flash (geração de lista estruturada)
"""
from __future__ import annotations

import json
import logging
import os

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.models.schemas import (
    DemandaEstruturada,
    MapaPrecos,
    MatrizAlternativas,
    MatrizRiscos,
    NivelRisco,
    ObjetoDecomposto,
    Risco,
    ValidacaoJuridica,
)

log = logging.getLogger("xerticaproc.agents.riscos")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente de Riscos da plataforma xerticaproc.

Responsabilidade: gerar a MATRIZ DE RISCOS completa da contratação.

Categorias obrigatórias de risco a avaliar:
1. preco — preço inexequível, baixa comparabilidade, outlier aceito
2. fornecedor — lock-in, monopólio, capacidade financeira
3. juridico — impugnação, especificação restritiva, não conformidade normativa
4. tecnico — indisponibilidade, integração, escalabilidade
5. lgpd — tratamento indevido de dados pessoais, ausência de DPA
6. operacional — adoção baixa, treinamento insuficiente, sustentação
7. nuvem — consumo sem controle, custos variáveis não previstos

Score de risco:
  alta × alto = 9 (crítico)
  alta × medio = 6 / alta × baixo = 3
  media × alto = 6 / media × medio = 4 / media × baixo = 2
  baixa × alto = 3 / baixa × medio = 2 / baixa × baixo = 1

Todo risco com score >= 6 deve ter mitigação concreta, não genérica.
Indicar se riscos críticos bloqueiam prosseguimento.

Retorne APENAS JSON válido."""


def gerar_matriz_riscos(
    demanda: DemandaEstruturada,
    objeto: ObjetoDecomposto,
    mapa_precos: MapaPrecos | None = None,
    matriz_alternativas: MatrizAlternativas | None = None,
    validacao_juridica: ValidacaoJuridica | None = None,
) -> MatrizRiscos:
    """Gera matriz de riscos consolidada via Gemini Flash."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(temperature=0.2, response_mime_type="application/json"),
    )

    # Contexto de preços
    ctx_precos = ""
    if mapa_precos:
        ctx_precos = f"""
Mapa de preços:
- Referências aceitas: {len(mapa_precos.referencias_aceitas)}
- Referências descartadas: {len(mapa_precos.referencias_descartadas)}
- Riscos da estimativa: {json.dumps(mapa_precos.riscos_estimativa, ensure_ascii=False)}
- Advertências: {json.dumps(mapa_precos.advertencias, ensure_ascii=False)}"""

    # Contexto jurídico
    ctx_juridico = ""
    if validacao_juridica:
        ctx_juridico = f"""
Validação jurídica:
- Alertas de impugnação: {json.dumps(validacao_juridica.alertas_impugnacao, ensure_ascii=False)}
- Pendências: {json.dumps(validacao_juridica.pendencias, ensure_ascii=False)}"""

    # Contexto de alternativas
    ctx_alt = ""
    if matriz_alternativas:
        riscos_alt = []
        for alt in matriz_alternativas.alternativas:
            if alt.recomendada:
                riscos_alt = alt.riscos
        ctx_alt = f"\nRiscos da alternativa escolhida: {json.dumps(riscos_alt, ensure_ascii=False)}"

    risco_direcionamento = objeto.risco_direcionamento.value
    ha_item_unico = any(it.alerta_direcionamento for it in objeto.itens)

    prompt = f"""
Contratação:
Objeto: {objeto.objeto_consolidado}
Modalidade: {objeto.modalidade_sugerida.value}
Risco de direcionamento pré-identificado: {risco_direcionamento}
Há item com alerta de direcionamento: {'sim' if ha_item_unico else 'não'}
{ctx_precos}
{ctx_juridico}
{ctx_alt}

Restrições da demanda: {json.dumps(demanda.restricoes, ensure_ascii=False)}
Dependências: {json.dumps(demanda.dependencias, ensure_ascii=False)}

Gere MatrizRiscos JSON:
{{
  "riscos": [
    {{
      "descricao": "Fornecedor único para o item X gera lock-in com dependência tecnológica",
      "categoria": "fornecedor",
      "probabilidade": "media",
      "impacto": "alto",
      "score_risco": 6,
      "mitigacao": "Exigir cláusula de portabilidade e migração em até 90 dias. Prever auditoria técnica anual.",
      "responsavel": "Gestor do contrato"
    }},
    ...
  ],
  "risco_mais_critico": "descricao do risco com maior score",
  "aprovado_para_prosseguir": true,
  "condicoes_para_prosseguir": []
}}
"""

    log.info("agente_riscos.start")
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    result = MatrizRiscos.model_validate_json(raw)
    log.info(
        "agente_riscos.done",
        extra={
            "n_riscos": len(result.riscos),
            "criticos": sum(1 for r in result.riscos if r.score_risco >= 6),
            "aprovado": result.aprovado_para_prosseguir,
        },
    )
    return result
