"""Agente 9 — Revisor/Auditor.

Confere o documento gerado contra o EvidenceBundle:
  ✓ Toda afirmação técnica tem evidência?
  ✓ Todo preço tem fonte rastreável?
  ✓ O TR está coerente com o ETP?
  ✓ A solução escolhida decorre do levantamento de mercado?
  ✓ Os critérios de aceite são mensuráveis?
  ✓ Há risco de especificação restritiva?
  ✓ Há tratamento LGPD?
  ✓ Há memória de cálculo?

Modelo: Gemini 2.5 Pro (análise crítica)
"""
from __future__ import annotations

import json
import logging
import os
from uuid import UUID

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

from xerticaproc.backend.models.schemas import (
    DocumentoGerado,
    EvidenceBundle,
    PendenciaRevisao,
    RelatorioRevisao,
    StatusAprovacao,
    TipoDocumento,
)

log = logging.getLogger("xerticaproc.agents.revisor")

_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
_MODEL = "gemini-2.0-flash"

_SYSTEM_PROMPT = """Você é o Agente Revisor/Auditor da plataforma xerticaproc.

Responsabilidade: verificar rigorosamente se o documento gerado (ETP ou TR) é:
1. Auditável — cada afirmação rastreável para uma evidência
2. Coerente — TR coerente com ETP, solução coerente com levantamento
3. Completo — todos os campos obrigatórios preenchidos ou com justificativa
4. Legal — sem especificação restritiva, sem citar marca sem justificativa
5. Mensurável — critérios de aceite verificáveis, SLA quantificado
6. Protegido (LGPD) — se houver dados pessoais, os requisitos estão presentes

Pendências "criticas" (bloqueiam aprovação):
- Preço sem fonte identificável
- Afirmação de viabilidade sem levantamento de mercado
- TR com objeto diferente do ETP
- Requisito com marca específica sem justificativa
- Ausência de critérios de aceite mensuráveis
- Ausência de tratamento LGPD quando há dados pessoais

Pendências "não-críticas" (recomendar correção mas não bloquear):
- Texto vago ou genérico em seções descritivas
- Referência normativa incompleta (sem número do artigo)
- Falta de prazo específico em alguma cláusula

Retorne APENAS JSON válido."""


def revisar_documento(
    documento: DocumentoGerado,
    bundle: EvidenceBundle,
) -> RelatorioRevisao:
    """Revisa o documento gerado contra o bundle de evidências."""
    vertexai.init(project=_PROJECT, location=_LOCATION)
    model = GenerativeModel(
        _MODEL,
        system_instruction=_SYSTEM_PROMPT,
        generation_config=GenerationConfig(temperature=0.1, response_mime_type="application/json"),
    )

    # Resumo do bundle para contexto
    tem_precos = bundle.mapa_precos is not None and len(bundle.mapa_precos.referencias_aceitas) > 0
    tem_alternativas = bundle.matriz_alternativas is not None
    tem_riscos = bundle.matriz_riscos is not None
    tem_juridico = bundle.validacao_juridica is not None
    pendentes_no_doc = documento.afirmacoes_sem_evidencia

    # Conteúdo do documento (primeiros 8000 chars para caber no contexto)
    conteudo_resumido = documento.conteudo_markdown[:8000]
    if len(documento.conteudo_markdown) > 8000:
        conteudo_resumido += "\n... [DOCUMENTO TRUNCADO PARA REVISÃO] ..."

    prompt = f"""
Revisar o seguinte {documento.tipo.value}:

--- INÍCIO DO DOCUMENTO ---
{conteudo_resumido}
--- FIM DO DOCUMENTO ---

Contexto do EvidenceBundle:
- Tem mapa de preços com referências: {tem_precos}
- Tem matriz de alternativas: {tem_alternativas}
- Tem matriz de riscos: {tem_riscos}
- Tem validação jurídica: {tem_juridico}
- Afirmações marcadas como PENDENTE no documento: {len(pendentes_no_doc)}
- Exemplos de pendentes: {json.dumps(pendentes_no_doc[:3], ensure_ascii=False)}

Tipo de documento: {documento.tipo.value}
Contratação: {str(documento.contratacao_id)}

Perguntas de revisão:
1. Há preços citados no documento? Todos têm fonte rastreável?
2. A solução escolhida foi justificada a partir do levantamento de mercado?
3. Os critérios de aceite são mensuráveis e verificáveis?
4. Há risco de especificação restritiva (marca, produto específico)?
5. Se houver dados pessoais, há tratamento LGPD adequado?
{'6. O TR está coerente com o ETP aprovado?' if documento.tipo == TipoDocumento.TR else ''}
7. Há memória de cálculo para o valor estimado?
8. Todos os elementos obrigatórios do art. 18 (ETP) ou art. 24 (TR) da IN 94/2022 estão presentes?

Gere RelatorioRevisao JSON:
{{
  "documento_id": "{str(documento.id)}",
  "aprovado": true,
  "pendencias": [
    {{
      "tipo": "preco_sem_fonte",
      "descricao": "Valor R$ X.XXX na seção 6 não referencia a fonte de pesquisa",
      "localizacao": "Seção 6 — Estimativa de Valor",
      "critica": true
    }}
  ],
  "pendencias_criticas": 0,
  "resumo": "Documento conforme. X pendências não-críticas para correção.",
  "recomendacoes": [],
  "checklist_etp_completo": true,
  "checklist_tr_coerente": true,
  "todas_afirmacoes_tem_evidencia": true,
  "todos_precos_tem_fonte": true,
  "criterios_aceite_mensuraveis": true,
  "sem_risco_especificacao_restritiva": true
}}
"""

    log.info("agente_revisor.start", extra={"tipo": documento.tipo.value, "doc_id": str(documento.id)})
    response = model.generate_content(prompt)
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    result = RelatorioRevisao.model_validate_json(raw)

    # Atualizar status do documento com base na revisão
    if result.pendencias_criticas > 0:
        documento.status_aprovacao = StatusAprovacao.REJEITADO
    elif result.aprovado:
        documento.status_aprovacao = StatusAprovacao.APROVADO
    else:
        documento.status_aprovacao = StatusAprovacao.REVISAO_SOLICITADA

    log.info(
        "agente_revisor.done",
        extra={
            "aprovado": result.aprovado,
            "pendencias_criticas": result.pendencias_criticas,
            "total_pendencias": len(result.pendencias),
        },
    )
    return result
