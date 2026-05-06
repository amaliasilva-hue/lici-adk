"""Agente 8 — Redator de ETP/TR.

Gera o texto do ETP (Estudo Técnico Preliminar) ou TR (Termo de Referência)
SOMENTE com base no EvidenceBundle fornecido pelo orquestrador.

Regra hard: não pode inventar fonte, preço, requisito ou afirmação.
Toda afirmação relevante deve ser rastreável para um item do EvidenceBundle.
Afirmações sem evidência são marcadas como "Informação pendente de validação".

Modelo: Gemini 2.5 Pro (geração de texto formal de alta qualidade)
"""
from __future__ import annotations

import json
import logging
import os
from uuid import uuid4

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.models.schemas import (
    DocumentoGerado,
    EvidenceBundle,
    StatusAprovacao,
    TipoDocumento,
)

log = logging.getLogger("xerticaproc.agents.redator")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_ETP = """Você é o Agente Redator de ETP da plataforma xerticaproc.

Gera o ESTUDO TÉCNICO PRELIMINAR (ETP) conforme:
- Art. 18 da IN SGD/ME nº 94/2022
- Art. 18 da Lei nº 14.133/2021

Estrutura obrigatória do ETP:
1. Descrição da Necessidade
2. Previsão no Plano de Contratações Anual (PCA)
3. Requisitos da Contratação
4. Estimativa das Quantidades
5. Levantamento de Mercado
6. Estimativa de Valor
7. Descrição da Solução como um todo
8. Justificativa para o Parcelamento ou não Parcelamento
9. Resultados e Benefícios Esperados
10. Providências a serem adotadas pela Administração
11. Contratações Correlatas e Interdependentes
12. Declaração de Viabilidade

Regras absolutas:
1. Usar APENAS informações do EvidenceBundle fornecido
2. Preços DEVEM referenciar o mapa de preços com fonte explícita
3. Alternativas DEVEM referenciar a matriz de alternativas
4. Requisitos DEVEM referenciar os requisitos técnicos aprovados
5. Riscos DEVEM referenciar a matriz de riscos
6. Informação sem evidência → usar placeholder: [PENDENTE: descrever o que falta]
7. Não gerar TR coerente com o ETP — isso é checado pelo revisor
8. Tom: formal, objetivo, no padrão da Administração Pública Federal
9. Retornar Markdown estruturado com cabeçalhos H2/H3"""

_SYSTEM_TR = """Você é o Agente Redator de TR da plataforma xerticaproc.

Gera o TERMO DE REFERÊNCIA (TR) conforme:
- Art. 24 da IN SGD/ME nº 94/2022
- Lei nº 14.133/2021

Estrutura obrigatória do TR:
1. Objeto
2. Condições Gerais da Contratação
3. Descrição da Solução como um todo
4. Fundamentação e Descrição da Necessidade
5. Requisitos da Contratação
6. Modelo de Execução do Objeto
7. Modelo de Gestão do Contrato
8. Critérios de Medição e Pagamento
9. Critérios de Seleção do Fornecedor
10. Estimativas do Valor da Contratação
11. Adequação Orçamentária
12. Sanções Administrativas
13. Proteção de Dados Pessoais (LGPD)
14. Anexos (se houver)

Regras: mesmas do ETP.
Tom: formal, técnico, no padrão da Administração Pública Federal.
Retornar Markdown estruturado."""


def redigir_etp(bundle: EvidenceBundle) -> DocumentoGerado:
    """Gera o ETP a partir do EvidenceBundle."""
    if not bundle.completo_para_etp:
        missing = []
        if not bundle.demanda:
            missing.append("demanda estruturada")
        if not bundle.objeto_decomposto:
            missing.append("objeto decomposto")
        if not bundle.matriz_alternativas:
            missing.append("matriz de alternativas")
        if not bundle.mapa_precos:
            missing.append("mapa de preços")
        if not bundle.requisitos_tecnicos:
            missing.append("requisitos técnicos")
        if not bundle.matriz_riscos:
            missing.append("matriz de riscos")
        raise ValueError(f"EvidenceBundle incompleto para ETP. Faltam: {', '.join(missing)}")

    return _redigir(bundle, TipoDocumento.ETP, _SYSTEM_ETP)


def redigir_tr(bundle: EvidenceBundle) -> DocumentoGerado:
    """Gera o TR a partir do EvidenceBundle."""
    if not bundle.completo_para_tr:
        raise ValueError("EvidenceBundle incompleto para TR. Completar ETP e validação jurídica primeiro.")
    return _redigir(bundle, TipoDocumento.TR, _SYSTEM_TR)


def _redigir(bundle: EvidenceBundle, tipo: TipoDocumento, system: str) -> DocumentoGerado:
    """Função interna de redação."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=system,
        generation_config=GenerationConfig(temperature=0.3),
    )

    # Serializa o bundle em JSON resumido para o prompt
    bundle_resumo = _bundle_para_prompt(bundle, tipo)

    prompt = f"""
Com base EXCLUSIVAMENTE no seguinte EvidenceBundle, redigir o {tipo.value}.

EvidenceBundle:
{bundle_resumo}

IMPORTANTE:
- Todo preço citado DEVE ter a fonte: ex: "(Referência: ARP-2024-0012, Ministério X, R$ 150,00/usuário/mês)"
- Toda alternativa DEVE referenciar: "(Fonte: Matriz de Alternativas — Solução B)"
- Toda afirmação sem evidência no bundle → usar: "[PENDENTE: descrever o que falta]"
- Não inventar números, entidades, datas ou requisitos não presentes no bundle
- Formato: Markdown com cabeçalhos ## para seções principais, ### para subseções
"""

    log.info("agente_redator.start", extra={"tipo": tipo.value, "contratacao": str(bundle.contratacao_id)})
    response = model.generate_content(prompt)
    conteudo = response.text.strip()

    # Detectar afirmações pendentes
    pendentes = [
        linha.strip()
        for linha in conteudo.split("\n")
        if "[PENDENTE" in linha.upper()
    ]

    doc = DocumentoGerado(
        contratacao_id=bundle.contratacao_id,
        tipo=tipo,
        conteudo_markdown=conteudo,
        evidence_bundle_id=bundle.contratacao_id,  # simplificado — usar UUID real do bundle
        afirmacoes_sem_evidencia=pendentes,
        status_aprovacao=StatusAprovacao.PENDENTE,
    )
    log.info(
        "agente_redator.done",
        extra={"tipo": tipo.value, "pendentes": len(pendentes), "chars": len(conteudo)},
    )
    return doc


def _bundle_para_prompt(bundle: EvidenceBundle, tipo: TipoDocumento) -> str:
    """Serializa o bundle de forma concisa para o prompt."""
    partes: list[str] = []

    if bundle.demanda:
        d = bundle.demanda
        partes.append(f"""
### DEMANDA
- Problema público: {d.problema_publico}
- Objetivo: {d.objetivo_contratacao}
- Unidade demandante: {d.unidade_demandante}
- Resultados esperados: {json.dumps(d.resultados_esperados, ensure_ascii=False)}
- Restrições: {json.dumps(d.restricoes, ensure_ascii=False)}
- Diagnóstico: {d.diagnostico}
- Alinhamento PCA: {d.alinhamento_pca or 'não informado'}""")

    if bundle.objeto_decomposto:
        o = bundle.objeto_decomposto
        itens_str = "\n".join(f"  * {it.nome} ({it.tipo}, {it.unidade_medida.value})" for it in o.itens)
        partes.append(f"""
### OBJETO DECOMPOSTO
- Objeto: {o.objeto_consolidado}
- Modalidade: {o.modalidade_sugerida.value}
- Justificativa modalidade: {o.justificativa_modalidade}
- Itens:
{itens_str}
- Alertas: {json.dumps(o.alertas, ensure_ascii=False)}""")

    if bundle.matriz_alternativas:
        ma = bundle.matriz_alternativas
        alts_str = "\n".join(
            f"  * {a.nome}: {a.descricao[:100]}... (custo: {a.custo_estimado_range})"
            for a in ma.alternativas
        )
        partes.append(f"""
### MATRIZ DE ALTERNATIVAS
- Alternativas avaliadas:
{alts_str}
- Escolhida: {ma.alternativa_escolhida}
- Justificativa: {ma.justificativa_escolha}""")

    if bundle.mapa_precos:
        mp = bundle.mapa_precos
        refs_str = "\n".join(
            f"  * {r.orgao or 'Órgão N/A'} | {r.numero_documento or 'N/A'} | "
            f"R$ {r.valor_unitario:.2f}/{r.unidade_normalizada.value} | "
            f"Comparabilidade: {r.nivel_comparabilidade.value} (score: {r.score_comparabilidade:.2f})"
            for r in mp.referencias_aceitas[:10]
        )
        partes.append(f"""
### MAPA DE PREÇOS
- Unidade: {mp.unidade_medida.value}
- Vigência: {mp.vigencia_meses} meses
- Quantidade referência: {mp.quantidade_referencia}
- Preço médio: R$ {mp.preco_medio:.2f}
- Preço mediana: R$ {mp.preco_mediana:.2f}
- Menor preço: R$ {mp.menor_preco:.2f}
- Preço referência recomendado: R$ {mp.preco_referencia_recomendado:.2f}
- Método: {mp.metodo_calculo}
- Referências aceitas ({len(mp.referencias_aceitas)} total, mostrando top 10):
{refs_str}
- Normalização: {mp.memoria_normalizacao}
- Riscos: {json.dumps(mp.riscos_estimativa, ensure_ascii=False)}""")

    if bundle.requisitos_tecnicos:
        req = bundle.requisitos_tecnicos
        partes.append(f"""
### REQUISITOS TÉCNICOS
- Funcionais ({len(req.requisitos_funcionais)}): {json.dumps(req.requisitos_funcionais[:5], ensure_ascii=False)}
- Não-funcionais: {json.dumps(req.requisitos_nao_funcionais[:5], ensure_ascii=False)}
- Segurança: {json.dumps(req.requisitos_seguranca[:3], ensure_ascii=False)}
- SLA: {json.dumps(req.niveis_servico, ensure_ascii=False)}
- Critérios de aceite: {json.dumps(req.criterios_aceite[:3], ensure_ascii=False)}
- LGPD: {json.dumps(req.requisitos_lgpd[:3], ensure_ascii=False)}""")

    if bundle.validacao_juridica and tipo == TipoDocumento.TR:
        vj = bundle.validacao_juridica
        partes.append(f"""
### VALIDAÇÃO JURÍDICA
- Aderente Lei 14.133: {vj.aderente_lei_14133}
- Aderente IN 94/2022: {vj.aderente_in_94_2022}
- Aderente LGPD: {vj.aderente_lgpd}
- Pendências: {json.dumps(vj.pendencias, ensure_ascii=False)}
- Alertas de impugnação: {json.dumps(vj.alertas_impugnacao, ensure_ascii=False)}
- Referências normativas: {json.dumps(vj.referencias_normativas[:5], ensure_ascii=False)}""")

    if bundle.matriz_riscos:
        mr = bundle.matriz_riscos
        riscos_altos = [r for r in mr.riscos if r.score_risco >= 6]
        partes.append(f"""
### MATRIZ DE RISCOS
- Total de riscos: {len(mr.riscos)}
- Riscos críticos (score >= 6): {len(riscos_altos)}
- Risco mais crítico: {mr.risco_mais_critico}
- Aprovado para prosseguir: {mr.aprovado_para_prosseguir}""")

    return "\n".join(partes)
