"""Score de Comparabilidade — Implementação do índice multidimensional.

Conforme definido na ARCHITECTURE.md:

Score = (
  + 20 se objeto similar
  + 20 se mesmo fabricante/SKU
  + 15 se mesma vigência (normalizada)
  + 15 se mesma unidade de medida
  + 10 se mesma escala de quantidade (± 30%)
  + 10 se mesma modalidade
  + 10 se mesma composição de suporte incluída
  + 10 se fonte oficial com URL verificável
  -  5 por divergência de escopo identificada
  - 10 por ausência de documento original
  - 15 por preço sem memória de cálculo
  - 20 se sem origem rastreável
) / 100

Resultado: float entre 0.0 e 1.0
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from xerticaproc.backend.models.schemas import (
    ItemPreco,
    TipoFonteMercado,
    UnidadeMedida,
)

# Fontes consideradas "oficiais" para bônus de +10
_FONTES_OFICIAIS = {
    TipoFonteMercado.PNCP,
    TipoFonteMercado.COMPRAS_GOV,
    TipoFonteMercado.PAINEL_PRECOS,
    TipoFonteMercado.ARP,
    TipoFonteMercado.CONTRATO,
}

# Penalidade extra para fontes sem rastreabilidade
_FONTES_SEM_RASTREABILIDADE = {
    TipoFonteMercado.FABRICANTE,
}

# Data mínima aceitável: publicações com mais de 24 meses recebem penalidade
_MESES_LIMITE_PUBLICACAO = 24


def calcular_score_comparabilidade(
    item: ItemPreco,
    objeto_ref: str,
    unidade_ref: UnidadeMedida,
    vigencia_ref_meses: int,
    quantidade_ref: float,
    fabricante_ref: str | None = None,
    sku_ref: str | None = None,
) -> tuple[float, dict[str, Any]]:
    """Calcula score de comparabilidade de um ItemPreco contra a referência.
    
    Returns:
        (score_0_a_1, detalhes_do_calculo)
    """
    pontos = 0
    detalhes: dict[str, Any] = {}

    # ── 1. Objeto similar (+20) ────────────────────────────────────────────
    sim_objeto = _similaridade_texto(item.descricao_normalizada, objeto_ref.lower())
    if sim_objeto >= 0.7:
        pontos += 20
        detalhes["objeto_similar"] = True
    elif sim_objeto >= 0.4:
        pontos += 10
        detalhes["objeto_similar"] = "parcial"
    else:
        detalhes["objeto_similar"] = False

    # ── 2. Mesmo fabricante/SKU (+20) ─────────────────────────────────────
    if fabricante_ref and item.fabricante:
        if _normalizar_nome(item.fabricante) == _normalizar_nome(fabricante_ref):
            pontos += 20
            detalhes["mesmo_fabricante"] = True
        elif sku_ref and item.sku and item.sku.lower().strip() == sku_ref.lower().strip():
            pontos += 20
            detalhes["mesmo_sku"] = True
        else:
            detalhes["mesmo_fabricante"] = False
    else:
        detalhes["mesmo_fabricante"] = "desconhecido"

    # ── 3. Mesma vigência normalizada (+15) ───────────────────────────────
    if item.vigencia_meses:
        diff_relativo = abs(item.vigencia_meses - vigencia_ref_meses) / vigencia_ref_meses
        if diff_relativo <= 0.10:  # até 10% de diferença → igual
            pontos += 15
            detalhes["vigencia_igual"] = True
        elif diff_relativo <= 0.25:  # até 25% → penalidade parcial
            pontos += 8
            detalhes["vigencia_igual"] = "proxima"
        else:
            detalhes["vigencia_igual"] = False
            detalhes["vigencia_diferenca_pct"] = round(diff_relativo * 100, 1)
    else:
        detalhes["vigencia_igual"] = "desconhecida"

    # ── 4. Mesma unidade de medida (+15) ─────────────────────────────────
    if item.unidade_normalizada == unidade_ref:
        pontos += 15
        detalhes["mesma_unidade"] = True
    else:
        detalhes["mesma_unidade"] = False
        detalhes["unidade_item"] = item.unidade_normalizada.value
        detalhes["unidade_ref"] = unidade_ref.value

    # ── 5. Mesma escala de quantidade (±30%) (+10) ────────────────────────
    if item.quantidade and quantidade_ref > 0:
        ratio = item.quantidade / quantidade_ref
        if 0.70 <= ratio <= 1.30:
            pontos += 10
            detalhes["escala_similar"] = True
        elif 0.50 <= ratio <= 2.00:
            pontos += 5
            detalhes["escala_similar"] = "proxima"
        else:
            detalhes["escala_similar"] = False
            detalhes["ratio_quantidade"] = round(ratio, 2)
    else:
        detalhes["escala_similar"] = "desconhecida"

    # ── 6. Fonte oficial (+10) ────────────────────────────────────────────
    if item.fonte_tipo in _FONTES_OFICIAIS and item.url:
        pontos += 10
        detalhes["fonte_oficial"] = True
    elif item.fonte_tipo in _FONTES_OFICIAIS:
        pontos += 5
        detalhes["fonte_oficial"] = "sem_url"
    else:
        detalhes["fonte_oficial"] = False

    # ── 7. Composição de suporte similar (+10) ────────────────────────────
    # (simplificado — considera contexto da fonte)
    if item.fonte_tipo in (TipoFonteMercado.ARP, TipoFonteMercado.CONTRATO):
        pontos += 10  # ARPs e contratos tipicamente têm composição documentada
        detalhes["composicao_documentada"] = True
    else:
        detalhes["composicao_documentada"] = "parcial"
        pontos += 5

    # ── 8. Penalidades ────────────────────────────────────────────────────

    # Penalidade: fonte sem rastreabilidade (-20)
    if item.fonte_tipo in _FONTES_SEM_RASTREABILIDADE and not item.numero_documento:
        pontos -= 20
        detalhes["penalidade_sem_rastreabilidade"] = -20

    # Penalidade: ausência de documento original (-10)
    if not item.numero_documento and not item.url:
        pontos -= 10
        detalhes["penalidade_sem_documento"] = -10

    # Penalidade: publicação antiga > 24 meses (-15)
    if item.data_publicacao:
        meses_desde_publicacao = (date.today() - item.data_publicacao).days / 30
        if meses_desde_publicacao > _MESES_LIMITE_PUBLICACAO:
            penalidade = min(15, int(meses_desde_publicacao / 12) * 5)
            pontos -= penalidade
            detalhes["penalidade_publicacao_antiga"] = -penalidade
            detalhes["meses_desde_publicacao"] = round(meses_desde_publicacao)
    else:
        # Sem data → penalidade moderada
        pontos -= 5
        detalhes["penalidade_sem_data"] = -5

    # Penalidade: divergência de escopo detectada (-5 por divergência)
    divergencias = _detectar_divergencias_escopo(item, objeto_ref)
    if divergencias:
        penalidade_escopo = min(20, len(divergencias) * 5)
        pontos -= penalidade_escopo
        detalhes["divergencias_escopo"] = divergencias
        detalhes["penalidade_divergencias"] = -penalidade_escopo

    # ── Score final ───────────────────────────────────────────────────────
    # Máximo teórico: 20+20+15+15+10+10+10 = 100
    MAX_PONTOS = 100
    score = max(0.0, min(1.0, pontos / MAX_PONTOS))
    detalhes["pontos_brutos"] = pontos
    detalhes["score_final"] = round(score, 4)

    # Identificar motivo principal de descarte se score baixo
    if score < 0.20:
        if not detalhes.get("objeto_similar"):
            detalhes["motivo_principal"] = "Objeto não corresponde ao item buscado"
        elif not detalhes.get("mesma_unidade"):
            detalhes["motivo_principal"] = f"Unidade incompatível: {item.unidade_normalizada.value} vs {unidade_ref.value}"
        elif detalhes.get("penalidade_sem_rastreabilidade"):
            detalhes["motivo_principal"] = "Fonte sem rastreabilidade documental"
        else:
            detalhes["motivo_principal"] = f"Score total insuficiente ({pontos}/100)"

    return score, detalhes


def _similaridade_texto(texto1: str, texto2: str) -> float:
    """Similaridade baseada em sobreposição de palavras relevantes (Jaccard simplificado).
    
    Exclui stopwords e termos genéricos.
    """
    STOPWORDS = {
        "de", "da", "do", "para", "com", "em", "a", "o", "e", "ou",
        "por", "que", "se", "na", "no", "um", "uma", "ao", "às",
        "contratação", "contrato", "serviço", "serviços", "sistema", "solução",
        "fornecimento", "aquisição", "prestação",
    }

    def tokenize(t: str) -> set[str]:
        words = re.findall(r"\b\w{3,}\b", t.lower())
        return {w for w in words if w not in STOPWORDS}

    tokens1 = tokenize(texto1)
    tokens2 = tokenize(texto2)

    if not tokens1 or not tokens2:
        return 0.0

    intersection = tokens1 & tokens2
    union = tokens1 | tokens2
    return len(intersection) / len(union)


def _normalizar_nome(nome: str) -> str:
    """Normaliza nome de fabricante para comparação."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", nome.lower())).strip()


def _detectar_divergencias_escopo(item: ItemPreco, objeto_ref: str) -> list[str]:
    """Detecta divergências de escopo óbvias entre item e objeto referência."""
    divergencias = []
    d = item.descricao_original.lower()
    o = objeto_ref.lower()

    # Detectar mistura de componentes incompatíveis
    if "implantação" in d or "implantacao" in d:
        if "implantação" not in o and "implantacao" not in o:
            divergencias.append("Item inclui implantação — não comparável diretamente se objeto é só licença")

    if "treinamento" in d or "training" in d:
        if "treinamento" not in o:
            divergencias.append("Item inclui treinamento — pode inflar o preço base")

    if "hardware" in d or "equipamento" in d:
        if "hardware" not in o and "equipamento" not in o:
            divergencias.append("Item inclui hardware — escopo diferente do objeto (software/serviço)")

    return divergencias
