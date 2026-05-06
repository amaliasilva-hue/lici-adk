"""Agente 3 — Pesquisa de Mercado.

A partir do objeto decomposto, pesquisa alternativas de solução e monta
a Matriz de Alternativas exigida pela IN SGD/ME nº 94/2022 (art. 18 do ETP).

Saída: MatrizAlternativas com ao menos 4 alternativas (incluindo "manter cenário atual")
Modelo: Gemini 2.5 Pro + Agent Search via grounding
"""
from __future__ import annotations

import json
import logging
import os

import vertexai
from vertexai.generative_models import (
    GenerativeModel,
    GenerationConfig,
    Tool,
    grounding,
)

from xerticaproc.backend.models.schemas import (
    AlternativaMercado,
    MatrizAlternativas,
    NivelRisco,
    ObjetoDecomposto,
)

log = logging.getLogger("xerticaproc.agents.mercado")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente de Pesquisa de Mercado da plataforma xerticaproc.

Sua função é construir a MATRIZ DE ALTERNATIVAS exigida pela IN SGD/ME nº 94/2022.
A matriz deve ter no mínimo 4 alternativas.

Obrigatório incluir sempre:
- Solução A: plataforma integrada (produto único consolidado)
- Solução B: desenvolvimento sob demanda / solução customizada
- Solução C: múltiplas ferramentas isoladas / melhor de cada categoria
- Solução D: manutenção do cenário atual (não contratar ou usar o que existe)

Para cada alternativa informar:
- Vantagens objetivas (não opiniões)
- Desvantagens objetivas
- Riscos específicos (lock-in, governança, custo oculto etc.)
- Custo estimado em faixa (ex: R$ 200k – R$ 500k/ano)
- Fonte da estimativa (se houver)

A alternativa recomendada deve ter justificativa baseada em fatos, não em preferência.
Alertar sobre RISCO DE LOCK-IN quando a alternativa recomendada for de fornecedor único.

Retorne APENAS JSON válido — sem texto adicional."""


def pesquisar_mercado(objeto: ObjetoDecomposto, usar_grounding: bool = True) -> MatrizAlternativas:
    """Pesquisa alternativas de mercado via Gemini Pro com Agent Search."""
    vertexai.init(project=_PROJECT, location=_LOCATION)

    tools = []
    if usar_grounding:
        try:
            tools.append(Tool.from_google_search())
        except AttributeError:
            pass  # grounding not supported in this SDK version

    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(temperature=0.3),
        tools=tools or None,
    )

    itens_str = "\n".join(
        f"  - {it.nome} ({it.tipo}, {it.unidade_medida.value})"
        for it in objeto.itens
    )

    prompt = f"""
Objeto consolidado: {objeto.objeto_consolidado}
Modalidade sugerida: {objeto.modalidade_sugerida.value}

Itens contratáveis identificados:
{itens_str}

Alertas já identificados: {json.dumps(objeto.alertas, ensure_ascii=False)}

Com base no mercado de TIC brasileiro para contratações públicas:
1. Pesquise alternativas reais de solução disponíveis no mercado nacional
2. Considere soluções que tenham precedente de contratação em órgãos públicos (PNCP/Compras.gov)
3. Monte a Matriz de Alternativas

Retorne JSON:
{{
  "alternativas": [
    {{
      "nome": "Solução A — ...",
      "descricao": "...",
      "vantagens": [...],
      "desvantagens": [...],
      "riscos": [...],
      "custo_estimado_range": "R$ X – R$ Y",
      "fonte_estimativa": "...",
      "recomendada": false
    }}
  ],
  "alternativa_escolhida": "nome da alternativa recomendada",
  "justificativa_escolha": "justificativa objetiva baseada em fatos",
  "fontes_consultadas": [...],
  "pontos_atencao": [...]
}}
"""

    log.info("agente_mercado.start", extra={"objeto": objeto.objeto_consolidado[:80]})
    response = model.generate_content(prompt)

    # Grounding com Google Search pode retornar texto + JSON mesclado
    raw = response.text.strip()
    # Extrair só o bloco JSON
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].strip()
    elif "{" in raw:
        start = raw.index("{")
        raw = raw[start:]

    result = MatrizAlternativas.model_validate_json(raw)
    log.info(
        "agente_mercado.done",
        extra={
            "n_alternativas": len(result.alternativas),
            "recomendada": result.alternativa_escolhida,
        },
    )
    return result
