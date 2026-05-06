"""Agente 4 — Pesquisa e Análise de Preços (crítico operacional).

Pipeline completo:
  1. Gera PlanoConsulta (queries + filtros + entidades a extrair)
  2. Aciona conectores PNCP + Compras.gov + Painel de Preços
  3. Normaliza unidades, vigência e composição
  4. Calcula score de comparabilidade por item
  5. Gera MapaPrecos com memória de cálculo auditável

O agente NÃO decide sozinho — monta o plano, consulta o banco e
entrega um pacote de evidências para aprovação humana.

Modelo: Gemini 2.5 Flash (extração/planejamento) + tools (conectores)
"""
from __future__ import annotations

import json
import logging
import os
import statistics
from datetime import date
from typing import Any
from uuid import UUID

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.connectors.compras_gov_connector import coletar_itens_compras_gov
from xerticaproc.backend.connectors.pncp_connector import coletar_itens_pncp
from xerticaproc.backend.models.schemas import (
    FiltrosPesquisaPrecos,
    ItemPreco,
    MapaPrecos,
    NivelComparabilidade,
    ObjetoDecomposto,
    PlanoConsulta,
    TipoFonteMercado,
    UnidadeMedida,
)
from xerticaproc.backend.tools.comparabilidade import calcular_score_comparabilidade
from xerticaproc.backend.tools.normalizacao import normalizar_valor_mensal

log = logging.getLogger("xerticaproc.agents.precos")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL_FLASH = "gemini-2.0-flash"

_SYSTEM_PLANO = """Você é o sub-agente de PLANEJAMENTO DA PESQUISA DE PREÇOS da plataforma xerticaproc.

Sua função é montar o plano de consulta ao PNCP e Compras.gov — não executar a busca.

Regras:
1. Queries devem ser específicas e em português brasileiro (vocabulário licitatório)
2. Incluir variações de terminologia (ex: "licença de software" e "licença de uso")
3. Identificar riscos de comparação ANTES da busca (ex: UST ≠ hora técnica)
4. Campos do mapa de preços: sempre incluir valor_unitario, unidade, vigencia_meses, orgao, data
5. Retornar APENAS JSON válido."""

_SYSTEM_NORMALIZACAO = """Você é o sub-agente de NORMALIZAÇÃO de preços da plataforma xerticaproc.

Para cada item de preço coletado, você deve:
1. Verificar se a descrição corresponde ao objeto buscado
2. Identificar o que está incluído no preço (licença? suporte? implantação? treinamento?)
3. Detectar outliers (preço > 3x a mediana = suspeito)
4. Classificar a comparabilidade

Regras absolutas:
- Não comparar contratos de vigência diferente sem normalizar por mês
- UST ≠ hora técnica ≠ ponto de função — não converter sem justificativa
- Licença ≠ suporte ≠ implantação — sempre separar se misturados
- Fonte sem data ou sem órgão identificado → score de confiabilidade reduzido em 0.2

Retornar análise de comparabilidade para cada item. APENAS JSON."""


def gerar_plano_consulta(
    objeto: ObjetoDecomposto,
    prazo_meses: int,
    quantidades: dict[str, Any],
    orgao: str,
    restricoes: list[str],
) -> PlanoConsulta:
    """Gera o PlanoConsulta antes de executar a busca."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL_FLASH,
        system_instruction=_SYSTEM_PLANO,
        generation_config=GenerationConfig(temperature=0.1, response_mime_type="application/json"),
    )

    itens_str = "\n".join(f"  - {it.nome} ({it.tipo}, {it.unidade_medida.value})" for it in objeto.itens)
    prompt = f"""
Planejar pesquisa de preços para:

Objeto: {objeto.objeto_consolidado}
Órgão: {orgao}
Prazo estimado: {prazo_meses} meses
Quantidades: {json.dumps(quantidades, ensure_ascii=False)}
Restrições: {json.dumps(restricoes, ensure_ascii=False)}
Itens a pesquisar:
{itens_str}

Gere JSON PlanoConsulta:
{{
  "objeto_da_contratacao": "...",
  "requisitos_tecnicos": "...",
  "prazo_estimado_meses": {prazo_meses},
  "quantidades": {json.dumps(quantidades, ensure_ascii=False)},
  "orgao": "{orgao}",
  "restricoes": {json.dumps(restricoes, ensure_ascii=False)},
  "queries_sugeridas": ["query1", "query2", ...],
  "filtros": {{"catmat": null, "catser": null, "data_inicio": "2024-01-01", "modalidade": null}},
  "entidades_a_extrair": ["valor_unitario", "unidade", "vigencia_meses", "orgao", "data_publicacao", "fabricante", "numero_ata"],
  "riscos_de_comparacao": ["..."],
  "campos_mapa_precos": ["valor_unitario", "unidade_normalizada", "vigencia_meses", "valor_mensal", "score_comparabilidade", "fonte"],
  "confianca": 0.8,
  "pendencias_antes_de_buscar": []
}}
"""
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return PlanoConsulta.model_validate_json(raw)


def _classificar_comparabilidade(score: float) -> NivelComparabilidade:
    if score >= 0.70:
        return NivelComparabilidade.ALTA
    if score >= 0.40:
        return NivelComparabilidade.MEDIA
    if score >= 0.20:
        return NivelComparabilidade.BAIXA
    return NivelComparabilidade.DESCARTADA


def pesquisar_precos(
    objeto: ObjetoDecomposto,
    contratacao_id: UUID,
    prazo_meses: int,
    quantidades: dict[str, Any],
    orgao: str,
    restricoes: list[str],
    unidade_medida_principal: UnidadeMedida = UnidadeMedida.USUARIO,
    quantidade_referencia: float = 1.0,
    filtros_extras: FiltrosPesquisaPrecos | None = None,
) -> MapaPrecos:
    """Executa pipeline completo: plano → coleta → normalização → mapa de preços."""

    log.info("agente_precos.start", extra={"objeto": objeto.objeto_consolidado[:80]})

    # ── 1. Plano de consulta ──────────────────────────────────────────────────
    plano = gerar_plano_consulta(objeto, prazo_meses, quantidades, orgao, restricoes)
    log.info("agente_precos.plano_gerado", extra={"queries": len(plano.queries_sugeridas)})

    # ── 2. Coleta de fontes ───────────────────────────────────────────────────
    todos_itens: list[ItemPreco] = []
    data_inicio = date(date.today().year - 2, 1, 1)

    for query in plano.queries_sugeridas[:5]:  # máximo 5 queries
        # PNCP
        try:
            itens_pncp = coletar_itens_pncp(
                palavras_chave=query.split()[:4],
                data_inicio=data_inicio,
                limite=30,
            )
            todos_itens.extend(itens_pncp)
        except Exception as e:
            log.warning("agente_precos.pncp_error", extra={"query": query, "error": str(e)})

        # Compras.gov + Painel de Preços
        try:
            itens_gov = coletar_itens_compras_gov(
                descricao=query,
                data_inicio=data_inicio,
                limite=30,
            )
            todos_itens.extend(itens_gov)
        except Exception as e:
            log.warning("agente_precos.compras_gov_error", extra={"query": query, "error": str(e)})

    log.info("agente_precos.coleta_concluida", extra={"total_bruto": len(todos_itens)})

    # ── 3. Deduplicação por hash (orgao+descricao+valor+data) ─────────────────
    seen: set[str] = set()
    itens_unicos: list[ItemPreco] = []
    for item in todos_itens:
        chave = f"{item.orgao}|{item.descricao_normalizada[:50]}|{item.valor_unitario}|{item.data_publicacao}"
        if chave not in seen:
            seen.add(chave)
            itens_unicos.append(item)

    # ── 4. Normalização de valor mensal ───────────────────────────────────────
    for item in itens_unicos:
        if item.vigencia_meses and item.vigencia_meses > 0:
            item.valor_mensal_por_unidade = normalizar_valor_mensal(
                item.valor_unitario, item.vigencia_meses
            )

    # ── 5. Score de comparabilidade ───────────────────────────────────────────
    for item in itens_unicos:
        score, detalhes = calcular_score_comparabilidade(
            item=item,
            objeto_ref=objeto.objeto_consolidado,
            unidade_ref=unidade_medida_principal,
            vigencia_ref_meses=prazo_meses,
            quantidade_ref=quantidade_referencia,
        )
        item.score_comparabilidade = score
        item.score_detalhes = detalhes
        item.nivel_comparabilidade = _classificar_comparabilidade(score)
        if item.nivel_comparabilidade == NivelComparabilidade.DESCARTADA:
            item.motivo_descarte = detalhes.get("motivo_principal", "score abaixo do mínimo")

    # ── 6. Separar aceitas × descartadas ─────────────────────────────────────
    aceitas = [i for i in itens_unicos if i.nivel_comparabilidade != NivelComparabilidade.DESCARTADA]
    descartadas = [i for i in itens_unicos if i.nivel_comparabilidade == NivelComparabilidade.DESCARTADA]

    log.info(
        "agente_precos.score_concluido",
        extra={"aceitas": len(aceitas), "descartadas": len(descartadas)},
    )

    # ── 7. Calculando estatísticas ────────────────────────────────────────────
    if not aceitas:
        # Sem referências aceitáveis — retornar mapa com advertência
        return MapaPrecos(
            contratacao_id=contratacao_id,
            objeto=objeto.objeto_consolidado,
            unidade_medida=unidade_medida_principal,
            vigencia_meses=prazo_meses,
            quantidade_referencia=quantidade_referencia,
            referencias_aceitas=[],
            referencias_descartadas=descartadas,
            preco_medio=0,
            preco_mediana=0,
            menor_preco=0,
            maior_preco=0,
            preco_referencia_recomendado=0,
            metodo_calculo="Sem referências aceitáveis — pesquisa manual obrigatória",
            memoria_normalizacao="Nenhum item atingiu score mínimo de comparabilidade (>= 0.20)",
            riscos_estimativa=["ALTO: Ausência de referências públicas verificáveis"],
            advertencias=["Pesquisa de preços não concluída — aprovação humana obrigatória before prosseguir"],
            total_fontes_consultadas=len(todos_itens),
        )

    valores = [i.valor_unitario for i in aceitas]
    preco_medio = statistics.mean(valores)
    preco_mediana = statistics.median(valores)
    menor_preco = min(valores)
    maior_preco = max(valores)

    # Referência recomendada: mediana das referências de alta comparabilidade, ou mediana geral
    altas = [i.valor_unitario for i in aceitas if i.nivel_comparabilidade == NivelComparabilidade.ALTA]
    preco_ref = statistics.median(altas) if len(altas) >= 2 else preco_mediana

    n_alta = len(altas)
    n_media = len([i for i in aceitas if i.nivel_comparabilidade == NivelComparabilidade.MEDIA])
    metodo = (
        f"Mediana das {n_alta} referências de alta comparabilidade"
        if n_alta >= 2
        else f"Mediana de todas as {len(aceitas)} referências aceitas ({n_media} de média comparabilidade)"
    )

    # Memória de normalização
    normalizacoes_feitas: list[str] = []
    for item in aceitas:
        if item.valor_mensal_por_unidade and item.vigencia_meses != prazo_meses:
            normalizacoes_feitas.append(
                f"{item.numero_documento}: vigência original {item.vigencia_meses}m "
                f"→ normalizado para {prazo_meses}m = R$ {item.valor_mensal_por_unidade:.2f}/unid/mês"
            )
    memoria = (
        "\n".join(normalizacoes_feitas) if normalizacoes_feitas
        else "Nenhuma normalização de vigência necessária"
    )

    # Riscos e advertências
    riscos: list[str] = []
    advertencias: list[str] = []
    if n_alta < 3:
        riscos.append(f"MÉDIO: Apenas {n_alta} referências de alta comparabilidade (recomendado mínimo 3)")
    if len(aceitas) < 3:
        riscos.append("ALTO: Menos de 3 referências aceitas — pesquisa complementar recomendada")
    if (maior_preco / menor_preco) > 3.0 and len(aceitas) > 1:
        advertencias.append(
            f"Dispersão alta: maior preço {maior_preco:.2f} é {maior_preco/menor_preco:.1f}x o menor. Verificar outliers."
        )
    if plano.riscos_de_comparacao:
        riscos.extend(plano.riscos_de_comparacao)

    return MapaPrecos(
        contratacao_id=contratacao_id,
        objeto=objeto.objeto_consolidado,
        unidade_medida=unidade_medida_principal,
        vigencia_meses=prazo_meses,
        quantidade_referencia=quantidade_referencia,
        referencias_aceitas=aceitas,
        referencias_descartadas=descartadas,
        preco_medio=round(preco_medio, 2),
        preco_mediana=round(preco_mediana, 2),
        menor_preco=round(menor_preco, 2),
        maior_preco=round(maior_preco, 2),
        preco_referencia_recomendado=round(preco_ref, 2),
        metodo_calculo=metodo,
        memoria_normalizacao=memoria,
        riscos_estimativa=riscos,
        advertencias=advertencias,
        total_fontes_consultadas=len(todos_itens),
    )
