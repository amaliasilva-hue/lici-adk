"""Normalização de valores de preços.

Regras críticas (Guardrail G4, G5):
- Valores de contratos com vigência diferente DEVEM ser normalizados por mês
- Unidades diferentes (UST, hora técnica, ponto de função) NÃO são comparáveis sem conversão explícita
- Composição de preço (licença + suporte + implantação) deve ser separada quando possível
"""
from __future__ import annotations

import re
from typing import Any


def normalizar_valor_mensal(valor_unitario: float, vigencia_meses: int) -> float:
    """Divide o valor unitário pela vigência para obter valor mensal.
    
    Uso: quando comparar contratos de vigências diferentes.
    Ex: R$ 60.000/usuário em 36m → R$ 1.666,67/usuário/mês
    """
    if vigencia_meses <= 0:
        raise ValueError(f"vigencia_meses deve ser > 0, recebido: {vigencia_meses}")
    return round(valor_unitario / vigencia_meses, 4)


def normalizar_para_vigencia_alvo(
    valor_unitario: float,
    vigencia_original_meses: int,
    vigencia_alvo_meses: int,
) -> tuple[float, str]:
    """Normaliza valor para a vigência alvo da contratação.
    
    Returns:
        (valor_normalizado, descricao_da_normalizacao)
    """
    if vigencia_original_meses == vigencia_alvo_meses:
        return valor_unitario, "Sem normalização necessária (mesma vigência)"

    valor_mensal = normalizar_valor_mensal(valor_unitario, vigencia_original_meses)
    valor_normalizado = round(valor_mensal * vigencia_alvo_meses, 2)
    descricao = (
        f"R$ {valor_unitario:.2f}/{vigencia_original_meses}m "
        f"→ R$ {valor_mensal:.4f}/mês "
        f"→ R$ {valor_normalizado:.2f}/{vigencia_alvo_meses}m"
    )
    return valor_normalizado, descricao


def fator_escala_quantidade(quantidade_item: float, quantidade_referencia: float) -> float:
    """Calcula fator de ajuste por escala (economia de escala).
    
    Retorna o fator de ajuste: > 1.0 se item tem mais unidades (desconto esperado),
    < 1.0 se item tem menos (custo esperado maior).
    Usado apenas para informar o revisor — não aplicado automaticamente.
    """
    if quantidade_referencia <= 0:
        return 1.0
    ratio = quantidade_item / quantidade_referencia
    return round(ratio, 4)


def detectar_composicao_preco(descricao: str) -> dict[str, bool]:
    """Detecta componentes de preço na descrição.
    
    Retorna dict indicando o que está incluído no preço:
    {inclui_licenca, inclui_suporte, inclui_implantacao, inclui_treinamento, inclui_manutencao}
    """
    d = descricao.lower()
    return {
        "inclui_licenca": any(t in d for t in ["licença", "licenca", "license", "assinatura", "subscription"]),
        "inclui_suporte": any(t in d for t in ["suporte", "support", "helpdesk", "atendimento"]),
        "inclui_implantacao": any(t in d for t in ["implantação", "implantacao", "implementação", "deploy", "instalação"]),
        "inclui_treinamento": any(t in d for t in ["treinamento", "training", "capacitação", "curso"]),
        "inclui_manutencao": any(t in d for t in ["manutenção", "manutencao", "maintenance", "sustentação"]),
    }


def extrair_vigencia_meses_do_texto(texto: str) -> int | None:
    """Extrai vigência em meses de texto livre.
    
    Exemplos:
      "contrato de 36 meses" → 36
      "vigência de 1 ano" → 12
      "12 (doze) meses" → 12
    """
    # Tentar extrair meses diretamente
    meses_patterns = [
        r"(\d+)\s*(?:\()?\s*(?:meses?|months?|m\.?)(?:\))?",
        r"prazo\s+de\s+(\d+)\s*meses?",
        r"vigência\s+de\s+(\d+)\s*meses?",
    ]
    for pattern in meses_patterns:
        m = re.search(pattern, texto.lower())
        if m:
            return int(m.group(1))

    # Tentar extrair anos e converter
    anos_patterns = [
        r"(\d+)\s*(?:\()?\s*anos?(?:\))?",
        r"vigência\s+de\s+(\d+)\s*anos?",
    ]
    for pattern in anos_patterns:
        m = re.search(pattern, texto.lower())
        if m:
            return int(m.group(1)) * 12

    return None


def validar_unidade_comparavel(unidade1: str, unidade2: str) -> tuple[bool, str]:
    """Verifica se duas unidades são comparáveis.
    
    Returns:
        (comparavel, motivo_se_nao)
    """
    GRUPOS_INCOMPATIVEIS = [
        {"ust", "h.t.", "hora técnica", "hora tecnica", "hora-técnica"},
        {"ponto de função", "pfunc", "function point"},
        {"usuario", "usuário", "user"},
        {"licença", "licenca", "license"},
        {"credito", "crédito", "credit"},
    ]

    u1_norm = unidade1.lower().strip()
    u2_norm = unidade2.lower().strip()

    if u1_norm == u2_norm:
        return True, ""

    for grupo in GRUPOS_INCOMPATIVEIS:
        u1_no_grupo = any(t in u1_norm for t in grupo)
        u2_no_grupo = any(t in u2_norm for t in grupo)
        if u1_no_grupo and not u2_no_grupo:
            return False, f"'{unidade1}' e '{unidade2}' pertencem a grupos incompatíveis sem conversão"
        if u2_no_grupo and not u1_no_grupo:
            return False, f"'{unidade1}' e '{unidade2}' não são comparáveis diretamente"

    # Se chegou aqui, unidades são diferentes mas podem ser análogas — marcar como suspeito
    return False, f"Unidades diferentes ('{unidade1}' vs '{unidade2}') — verificar manualmente"
