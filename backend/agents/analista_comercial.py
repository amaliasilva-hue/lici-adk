"""Agente 3 — Analista.

Recebe `EditalEstruturado` + `QualificadorResult` + perfil YAML da Xertica e
produz `ParecerComercial` com lógica em 2 camadas (bloqueadores duros → score).

Refs: ARCHITECTURE.md §Agente 3 — Analista, §Lógica de Decisão em duas camadas.
"""
from __future__ import annotations

import json
import logging
import os
import textwrap
import time
from functools import lru_cache
from pathlib import Path

import vertexai
import yaml
from vertexai.generative_models import GenerationConfig, GenerativeModel

from backend.models.schemas import EditalEstruturado, ParecerComercial, QualificadorResult

log = logging.getLogger("lici_adk.analista")

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
# Vertex AI em us-central1 — única região com Gemini 2.5 Pro disponível hoje.
LOCATION = os.getenv("LICI_VERTEX_LOCATION", "us-central1")
MODEL_NAME = os.getenv("LICI_ANALISTA_MODEL", "gemini-2.5-pro")

PROFILE_PATH = Path(__file__).resolve().parent.parent / "xertica_profile.yaml"
PROFILE_KEYS_RELEVANTES = (
    "qualificacao_empresa",
    "realidade_contratual",
    "volumetria_comprovada",
    "certidoes_empresa",
    "especializacoes_google",
    "flags_bloqueadoras",
    "narrativa_gtm",
)

_initialized = False


def _init() -> None:
    global _initialized
    if not _initialized:
        vertexai.init(project=PROJECT, location=LOCATION)
        _initialized = True


@lru_cache(maxsize=1)
def _profile_resumido() -> dict:
    """Carrega o YAML uma vez e mantém só as seções que o Analista precisa."""
    full = yaml.safe_load(PROFILE_PATH.read_text())
    return {k: full[k] for k in PROFILE_KEYS_RELEVANTES if k in full}


SYSTEM_PROMPT = textwrap.dedent("""
Você é o Agente Analista do lici-adk — consultor sênior de pré-venda para licitações
públicas da Xertica Brasil. Produz pareceres auditáveis, não marketing.

=================== LÓGICA DE DECISÃO (OBRIGATÓRIA) ===================
Duas camadas SEQUENCIAIS. NUNCA devolva "score 82 mas INAPTO".

CAMADA 1 — Bloqueadores duros (avaliar PRIMEIRO)
Se QUALQUER item abaixo disparar, devolva status=NO-GO ou INAPTO,
score_aderencia=null, preencha `bloqueio_camada_1` com a regra que disparou,
e NÃO calcule score:
  1. edital.exclusividade_me_epp=true (Xertica não é ME/EPP) → NO-GO
  2. Edital exige consórcio OBRIGATÓRIO como membro → NO-GO
  3. localizacao_dados_exigida incompatível com `southamerica-*` → INAPTO
  4. Certificação corporativa obrigatória ausente em `certidoes_empresa.certidoes_iso` → INAPTO
  5. Qualificador devolveu ZERO atestados E ZERO contratos para os requisitos técnicos
     centrais E o edital exige atestado como habilitação MANDATÓRIA → INAPTO
  6. nivel_parceria_exigido superior ao de `qualificacao_empresa.parcerias_formais` → INAPTO
  7. edital.strict_match_atestados=true AND edital.restricao_temporal_experiencia_meses definido
     AND qualificador.atestados está VAZIO (zero atestados dentro do prazo) → INAPTO;
     preencha bloqueio_camada_1='strict_match_atestados: sem atestado nos últimos N meses — habilitação técnica inviável'
     (contratos sem atestado NÃO substituem atestados quando strict_match_atestados=true)

CAMADA 2 — Score 0-100 (só roda se Camada 1 passar integralmente)
Soma ponderada (total 100):
  - Cobertura de requisitos técnicos por atestados+contratos (peso 50)
  - Match com `realidade_contratual.objetos_mais_comuns` / contratos âncora (peso 15)
  - Adesão a Ata viável no órgão-alvo (peso 10)
  - Premier Partner ou alinhamento com `especializacoes_google` (peso 10)
  - Certificações profissionais cobrem perfis exigidos (peso 15)
Penalidades:
  - ≥3 deals_lost com mesma Causa_Raiz: -15
  - Cada gap de volumetria numérico: -10
Thresholds: APTO ≥75 | APTO COM RESSALVAS 41-74 | INAPTO ≤40.

=================== REGRAS DE RACIOCÍNIO ===================
- USN ≡ USNM ≡ Créditos GCP ≡ Consumo Cloud — não tratar como produtos distintos.
- UST ≈ USTc ≈ USTa ≈ hora técnica base, modulada por tabela_proporcionalidade_ust.
- Glosa ≥20% ou SLA agressivo (P1 2h, 99,9%+) → alerta "ALTO RISCO DE GLOSA".
- modelo_inovacao_etec=true → recomendar narrativa FDM (Fair Decision Making) como diferencial.
- Adesão a Ata: se órgão-alvo bate com modalidades_publicas_reais → sugerir como atalho.

=================== SOMADOR DE ATESTADOS DRIVE (Fase 4) ===================
Se o campo `somatorio_drive` estiver presente no payload (não-nulo e `drive_indisponivel=false`),
use os volumes somados ANTES de declarar gap de volumetria. Exemplos:
  - `somatorio_drive.atestados_por_categoria.GWS = 480000` → Xertica possui 480k licenças GWS
    comprovadas em atestados Drive; aplique ANTES de penalizar por gap de volumetria GWS.
  - `kit_minimo_recomendado` lista os atestados que individualmente atendem parcela_maior_relevancia.
Referencie-os em `evidencias_por_requisito` com `fonte_tabela = 'atestados'` e
`tipo_evidencia = 'atestado'`, usando `drive_file_name` como `fonte_id`.
Se `drive_indisponivel=true` ou `somatorio_drive=null`, ignore-o completamente.

=================== ANTI-ALUCINAÇÃO (#10) ===================
Se o Qualificador devolveu ZERO resultados para um requisito, NUNCA invente capacidade.
Declare GAP TOTAL, score máximo 40, recomende captação de atestado com cliente similar.

=================== CASCATA DE COMPROVAÇÃO (Fase 6) — OBRIGATÓRIA p/ requisitos quantitativos ===================
Para CADA requisito quantitativo do edital (volume mínimo em BRL, licenças, requisições, USTs, horas),
preencha um item em `requisitos_cascata` seguindo a regra de 3 níveis. Pare no primeiro nível que ATENDE:

  Nível 1 — NACIONAL: some apenas atestados com `origem == "nacional"` e contratos do BR.
  Nível 2 — INTERNACIONAL: acumula NACIONAL + atestados `origem == "internacional"`. Use
           `valor_brl_convertido` quando presente. Marque `observacao` lembrando que requer
           tradução juramentada / consularização.
  Nível 3 — CAPTAÇÃO: acumula níveis anteriores + estimativa dos `contratos_sem_atestado` que
           têm objeto compatível. Liste-os em `contribuintes` com `fonte = "contrato"` e
           orientação para SOLICITAR atestado ao cliente.

Cada `NivelComprovacao` deve ter:
  - `nivel`: "nacional" | "internacional" | "captacao"
  - `status`: "atende" (acumulado >= mínimo) | "parcial" (>0 mas < mínimo) | "nao_atende"
  - `valor_acumulado`: número total acumulado ATÉ ESSE NÍVEL (não apenas o delta)
  - `delta`: valor_acumulado - minimo_exigido (positivo = sobra, negativo = falta)
  - `contribuintes`: lista (max 8 mais relevantes) — cada um com fonte+rotulo+valor
  - `observacao`: nullable; preencha apenas se houver ressalva (ex: tradução, captação pendente)

`status_consolidado` reflete o melhor nível alcançado:
  - "atende" se algum nível chegou a "atende"
  - "parcial" se algum nível tem valor > 0 mas nenhum atende
  - "nao_atende" caso contrário
`nivel_que_satisfaz` aponta o primeiro nível que satisfaz (ou "nenhum").

EQUIVALÊNCIA SEMÂNTICA & PE:
Quando a comprovação só "fecha" se o pregoeiro aceitar uma equivalência discutível
(ex: UST IA ≈ CP-PROF-SVC-CREDITS, créditos integrador ≈ PSO, "uso de Maps API" ≈ requisições),
preencha `equivalencia_pe` com:
  - `motivo`: descreva a divergência (categoria/SKU/unidade)
  - `pergunta_sugerida`: texto formal pronto para protocolar como Pedido de Esclarecimento
  - `pe_score` (0-100): probabilidade do pregoeiro aceitar.
        - 80-100: equivalência clara, jurisprudência TCU favorável (ex: art. 67 §6º Lei 14.133)
        - 50-79: equivalência razoável mas depende de interpretação (UST↔créditos PSO)
        - 20-49: equivalência forçada, alto risco (valor R$ ↔ volume requisições API)
        - 0-19: praticamente sem chance — não vale o risco
  - `impacto_se_aceito`: descreva como muda o status do requisito

=================== CENÁRIOS (obrigatório quando há requisitos_cascata) ===================
Preencha `cenarios` com EXATAMENTE 2 entradas:
  1. {"nome":"conservador", ...} — assume que TODOS os PEs são REJEITADOS e que
     atestados internacionais NÃO foram aceitos pelo pregoeiro. Use Nível 1 apenas.
  2. {"nome":"otimista", ...} — assume que PEs com `pe_score >= 50` foram ACEITOS
     e que internacionais foram aceitos com tradução juramentada. Use até Nível 2.

Em cada cenário calcule `score_aderencia` e `status` aplicando a Camada 2 acima,
e preencha `requisitos_atendidos_count` / `requisitos_total` para a UI.
O `score_aderencia` e `status` no nível raiz do JSON devem refletir o cenário CONSERVADOR
(default), preservando o comportamento legado.

=================== EVIDÊNCIAS AUDITÁVEIS (OBRIGATÓRIO — PREENCHER TODOS OS CAMPOS) ===================
Para CADA requisito do edital (de requisitos_tecnicos E requisitos_habilitacao),
crie ao menos uma entrada em `evidencias_por_requisito`. OBRIGATÓRIOS:

  { "requisito": "rótulo curto do requisito",
    "texto_edital": "CÓPIA VERBATIM do texto do requisito como aparece em edital.requisitos_tecnicos ou edital.requisitos_habilitacao — NÃO resuma, copie na íntegra",
    "fonte_tabela": "atestados"|"contratos"|"closed_deals_won"|"certificados_xertica"|"xertica_profile.yaml",
    "fonte_id": "id do registro (AtestadoMatch.id, ContratoMatch.numerodocontrato, etc.)",
    "trecho_literal": "trecho COPIADO do resumodoatestado/resumodocontrato que comprova — copie o trecho exato, não parafraseie",
    "tipo_evidencia": "atestado"|"contrato"|"deal_won"|"certificado"|"yaml",
    "confianca": 0.0-1.0,
    "atestado_nome": "OBRIGATÓRIO p/ atestados/contratos — copie nomedaconta/nomedaconta do registro fonte",
    "atestado_resumo": "OBRIGATÓRIO — resumo do documento fonte COM valores monetários/volumétricos incluídos. Ex: 'Implantação Google Workspace para 15.000 usuários — R$ 4.200.000,00 em 36 meses'",
    "atestado_link": "linkdeacesso do AtestadoMatch ou atestado_linkdeacesso do ContratoMatch (se existir)",
    "valor_comprovado": 17730000.0,
    "unidade_valor": "BRL" }

REGRAS CRÍTICAS para evidências:
1. SEMPRE preencha `texto_edital` copiando na íntegra de edital.requisitos_tecnicos ou edital.requisitos_habilitacao
2. SEMPRE preencha `atestado_nome` com o nome da conta/contratante do documento fonte
3. SEMPRE preencha `atestado_resumo` incluindo valores monetários quando disponíveis (valordocontrato, gross, horas)
4. SEMPRE preencha `valor_comprovado` com o valor numérico que a evidência comprova (em BRL quando possível):
   - Para atestados: use valordocontrato vinculado, ou horas * taxa se disponível
   - Para contratos: use valordocontrato
   - Para deals: use gross
   - Se não há valor numérico, use null
5. `unidade_valor`: "BRL" para valores monetários, "horas" para horas técnicas, "licenças" para licenças, "UST" para USTs
6. Crie UMA evidência POR DOCUMENTO fonte — se o mesmo requisito é coberto por 3 atestados, crie 3 entradas
7. Se um requisito NÃO tem evidência alguma, crie uma entrada em `gaps` — não omita o requisito

=================== ENUMS — VALORES EXATOS (case-sensitive) ===================
NUNCA invente variações. Use APENAS estes valores literais:

- `requisitos_atendidos[].fonte` ∈ {"atestado", "contrato", "deal_won", "certificado", "yaml"}
  (singular, minúsculo — NUNCA "atestados", "contratos_com_atestado", "xertica_profile.yaml")

- `evidencias_por_requisito[].fonte_tabela` ∈ {"atestados", "contratos", "closed_deals_won", "certificados_xertica", "xertica_profile.yaml"}
  (NUNCA "contratos_com_atestado" / "contratos_sem_atestado" — use sempre "contratos")

- `evidencias_por_requisito[].tipo_evidencia` ∈ {"atestado", "contrato", "deal_won", "certificado", "yaml"}

- `gaps[].tipo` ∈ {"ausencia_total", "volumetria_insuficiente", "temporal", "certificacao", "certidao"}
  (snake_case, sem acento — NUNCA "Volumetria", "Ausência Total", "Certificação")

- `status` ∈ {"APTO", "APTO COM RESSALVAS", "INAPTO", "NO-GO"} (maiúsculas exatas)

Se o requisito tem múltiplas fontes, escolha A MAIS FORTE (atestado > contrato > deal_won > certificado > yaml) e crie UMA entrada por evidência.

=================== OUTPUT (APENAS JSON) ===================
ATENÇÃO: o JSON deve conter TODOS os requisitos do edital — tanto os atendidos quanto os gaps.
Liste em `evidencias_por_requisito` TODOS os documentos que comprovam cada requisito (1 entrada por documento).
Liste em `requisitos_atendidos` uma síntese por requisito atendido.
Liste em `gaps` cada requisito sem comprovação ou com comprovação insuficiente.

{
  "score_aderencia": null | 0-100,
  "status": "APTO" | "APTO COM RESSALVAS" | "INAPTO" | "NO-GO",
  "bloqueio_camada_1": null | "texto da regra que disparou",
  "requisitos_atendidos": [{"requisito","comprovacao","fonte","link"}],
  "evidencias_por_requisito": [
    {
      "requisito": "Computação na nuvem GCP",
      "texto_edital": "Comprovação de capacidade técnica em computação na nuvem Google Cloud Platform, com volume mínimo de R$ 52.000.000,00 em contratos executados nos últimos 60 meses",
      "fonte_tabela": "atestados",
      "fonte_id": "50",
      "trecho_literal": "Implantação e operação de ambiente integralmente em Google Cloud Platform para 15.000 colaboradores",
      "tipo_evidencia": "atestado",
      "confianca": 0.85,
      "atestado_nome": "SEBRAE/RN",
      "atestado_resumo": "Implantação GCP com 15.000 usuários, gestão de infra e segurança — R$ 17.730.000,00 em 36 meses",
      "atestado_link": "https://drive.google.com/...",
      "valor_comprovado": 17730000,
      "unidade_valor": "BRL"
    }
  ],
  "gaps": [{"requisito","tipo","delta_numerico","recomendacao"}],
  "requisitos_cascata": [
    {
      "requisito": "Tecnologia GCP — R$ 52.000.000,00",
      "minimo_exigido": 52000000,
      "unidade": "BRL",
      "niveis": [
        {"nivel":"nacional","status":"parcial","valor_acumulado":17730000,"delta":-34270000,
         "contribuintes":[{"fonte":"atestado","fonte_id":"50","rotulo":"SEBRAE/RN — Atestado 50","valor":17730000,"unidade":"BRL"}],
         "observacao":null},
        {"nivel":"internacional","status":"atende","valor_acumulado":65898738,"delta":13898738,
         "contribuintes":[{"fonte":"atestado","fonte_id":"95","rotulo":"Mutual Ser EPS","valor":12474000,"moeda_original":"USD","valor_original":2445000,"unidade":"BRL"}],
         "observacao":"Requer tradução juramentada"}
      ],
      "status_consolidado":"atende",
      "nivel_que_satisfaz":"internacional",
      "equivalencia_pe": null
    }
  ],
  "cenarios": [
    {"nome":"conservador","score_aderencia":35,"status":"INAPTO","requisitos_atendidos_count":2,"requisitos_total":4,"descricao":"PEs rejeitados, internacionais não aceitos"},
    {"nome":"otimista","score_aderencia":65,"status":"APTO COM RESSALVAS","requisitos_atendidos_count":3,"requisitos_total":4,"descricao":"PEs com pe_score>=50 aceitos, internacionais aceitos com tradução"}
  ],
  "estrategia": "recomendação objetiva de participação (2-4 parágrafos)",
  "alertas": ["..."],
  "campos_trello": {"titulo_card": "...", "checklist": ["..."]},
  "edital_orgao": "nome",
  "edital_modalidade": "Pregão..."
}
""").strip()

# Limite conservador para não estourar contexto do Pro (~1M, mas qualidade cai bem antes).
PAYLOAD_CHAR_LIMIT = 180_000

# ── Limites por fonte — trim inteligente antes de serializar.
_MAX_ATESTADOS = 15
_MAX_CONTRATOS_COM = 10
_MAX_CONTRATOS_SEM = 5
_MAX_DEALS_WON = 5
_MAX_DEALS_LOST = 3
_MAX_CERTIFICADOS = 20
_MAX_FIELD_CHARS = 800  # fallback: corta campos de texto longos


def _trim_qualificador(q: dict) -> dict:
    """Limita listas do qualificador pelo número de registros (shallow copy)."""
    q = dict(q)
    q["atestados"] = q.get("atestados", [])[:_MAX_ATESTADOS]
    q["contratos_com_atestado"] = q.get("contratos_com_atestado", [])[:_MAX_CONTRATOS_COM]
    q["contratos_sem_atestado"] = q.get("contratos_sem_atestado", [])[:_MAX_CONTRATOS_SEM]
    q["deals_won"] = q.get("deals_won", [])[:_MAX_DEALS_WON]
    q["deals_lost"] = q.get("deals_lost", [])[:_MAX_DEALS_LOST]
    q["certificados"] = q.get("certificados", [])[:_MAX_CERTIFICADOS]
    return q


def _trim_longos(q: dict) -> dict:
    """Fallback: trunca campos de texto longos dentro de cada registro."""
    import copy
    _TEXT = (
        "resumodoatestado", "resumodocontrato", "detalhamentoservicos",
        "resumo_analise", "fatores_sucesso", "licoes_aprendidas",
    )
    q = copy.deepcopy(q)
    for lista in ("atestados", "contratos_com_atestado", "contratos_sem_atestado", "deals_won", "deals_lost"):
        for rec in q.get(lista, []):
            for field in _TEXT:
                val = rec.get(field)
                if isinstance(val, str) and len(val) > _MAX_FIELD_CHARS:
                    rec[field] = val[:_MAX_FIELD_CHARS] + "…[truncado]"
    return q


# ── Normalização defensiva: o Pro às vezes inventa variações dos enums apesar do prompt.
# Em vez de falhar a validação, mapeamos sinônimos comuns para os literais válidos.
_FONTE_REQ_MAP = {
    "atestados": "atestado",
    "contratos": "contrato",
    "contratos_com_atestado": "contrato",
    "contratos_sem_atestado": "contrato",
    "closed_deals_won": "deal_won",
    "deals_won": "deal_won",
    "certificados": "certificado",
    "certificados_xertica": "certificado",
    "xertica_profile.yaml": "yaml",
    "xertica_profile": "yaml",
    "profile": "yaml",
}
_FONTE_TABELA_MAP = {
    "atestado": "atestados",
    "contrato": "contratos",
    "contratos_com_atestado": "contratos",
    "contratos_sem_atestado": "contratos",
    "deals_won": "closed_deals_won",
    "deal_won": "closed_deals_won",
    "certificado": "certificados_xertica",
    "certificados": "certificados_xertica",
    "yaml": "xertica_profile.yaml",
    "xertica_profile": "xertica_profile.yaml",
}
_GAP_TIPO_MAP = {
    "volumetria": "volumetria_insuficiente",
    "volumetria insuficiente": "volumetria_insuficiente",
    "insuficiente": "volumetria_insuficiente",
    "ausencia": "ausencia_total",
    "ausência": "ausencia_total",
    "ausência total": "ausencia_total",
    "ausencia total": "ausencia_total",
    "gap total": "ausencia_total",
    "temporal": "temporal",
    "prazo": "temporal",
    "certificacao": "certificacao",
    "certificação": "certificacao",
    "certidao": "certidao",
    "certidão": "certidao",
}


def _pick(value: str, mapping: dict, valid: set, default: str) -> str:
    if not isinstance(value, str):
        return default
    # Pode vir como "atestados, contratos_com_atestado" — pega o primeiro token útil.
    tokens = [t.strip().lower() for t in value.replace(";", ",").split(",") if t.strip()]
    for t in tokens:
        if t in valid:
            return t
        if t in mapping:
            return mapping[t]
    # fallback: tenta o valor inteiro normalizado
    low = value.strip().lower()
    if low in mapping:
        return mapping[low]
    return default


def _normalize_enums(d: dict) -> dict:
    """Conserta drift de enums no JSON do Pro antes de validar contra Pydantic."""
    valid_fonte = {"atestado", "contrato", "deal_won", "certificado", "yaml"}
    valid_tabela = {"atestados", "contratos", "closed_deals_won", "certificados_xertica", "xertica_profile.yaml"}
    valid_gap = {"ausencia_total", "volumetria_insuficiente", "temporal", "certificacao", "certidao"}

    for r in d.get("requisitos_atendidos") or []:
        if "fonte" in r:
            r["fonte"] = _pick(r["fonte"], _FONTE_REQ_MAP, valid_fonte, "yaml")

    for e in d.get("evidencias_por_requisito") or []:
        if "fonte_tabela" in e:
            e["fonte_tabela"] = _pick(e["fonte_tabela"], _FONTE_TABELA_MAP, valid_tabela, "xertica_profile.yaml")
        if "tipo_evidencia" in e:
            e["tipo_evidencia"] = _pick(e["tipo_evidencia"], _FONTE_REQ_MAP, valid_fonte, "yaml")

    for g in d.get("gaps") or []:
        if "tipo" in g:
            g["tipo"] = _pick(g["tipo"], _GAP_TIPO_MAP, valid_gap, "ausencia_total")

    # status: padroniza maiúsculas
    if isinstance(d.get("status"), str):
        s = d["status"].strip().upper()
        if s in {"APTO", "APTO COM RESSALVAS", "INAPTO", "NO-GO", "NO GO"}:
            d["status"] = "NO-GO" if s == "NO GO" else s

    return d


def analisar(
    edital: EditalEstruturado,
    qualificador: QualificadorResult,
    *,
    somatorio_drive: dict | None = None,
) -> ParecerComercial:
    """Produz o parecer final.

    Args:
        edital: edital estruturado pelo Extrator.
        qualificador: resultado do Qualificador (atestados, contratos, deals, certs).
        somatorio_drive: dict serializado de AtestadoSomatorio (Fase 4).
            Opcional — se None ou `drive_indisponivel=True`, é ignorado silenciosamente.
    """
    _init()
    model = GenerativeModel(MODEL_NAME, system_instruction=SYSTEM_PROMPT)

    q_dict = _trim_qualificador(qualificador.model_dump())
    somatorio_dict = (
        somatorio_drive
        if somatorio_drive and not somatorio_drive.get("drive_indisponivel")
        else None
    )
    payload = {
        "edital": edital.model_dump(),
        "qualificador": q_dict,
        "xertica_profile": _profile_resumido(),
        "somatorio_drive": somatorio_dict,
    }
    payload_json = json.dumps(payload, ensure_ascii=False, default=str)
    original_chars = len(payload_json)
    if original_chars > PAYLOAD_CHAR_LIMIT:
        # Tier-2: corta campos de texto longos dentro dos registros
        log.warning(
            "analista.payload_grande_apos_trim",
            extra={"chars": original_chars, "limit": PAYLOAD_CHAR_LIMIT},
        )
        payload["qualificador"] = _trim_longos(q_dict)
        payload_json = json.dumps(payload, ensure_ascii=False, default=str)
        if len(payload_json) > PAYLOAD_CHAR_LIMIT:
            # Tier-3: last resort — nunca deveria chegar aqui
            log.error(
                "analista.payload_ainda_grande",
                extra={"chars": len(payload_json), "limit": PAYLOAD_CHAR_LIMIT},
            )
            # Mantém payload válido, não trunca no meio do JSON
            payload["qualificador"]["atestados"] = payload["qualificador"]["atestados"][:5]
            payload_json = json.dumps(payload, ensure_ascii=False, default=str)

    t0 = time.time()
    response = model.generate_content(
        f"ANALISE o edital abaixo. Responda APENAS com o JSON do ParecerFinal.\n\n```json\n{payload_json}\n```",
        generation_config=GenerationConfig(temperature=0.2, response_mime_type="application/json"),
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = json.loads(response.text)
    raw = _normalize_enums(raw)
    parecer = ParecerComercial.model_validate(raw)

    # Preencher metadados se o LLM não preencheu
    if not parecer.edital_orgao:
        parecer.edital_orgao = edital.orgao
    if not parecer.edital_modalidade:
        parecer.edital_modalidade = edital.modalidade

    log.info(
        "analista.done",
        extra={
            "lici_adk": {
                "agent": "analista",
                "model": MODEL_NAME,
                "latency_ms": latency_ms,
                "status": parecer.status,
                "score": parecer.score_aderencia,
                "bloqueio": parecer.bloqueio_camada_1,
                "evidencias": len(parecer.evidencias_por_requisito),
                "gaps": len(parecer.gaps),
            }
        },
    )
    return parecer
