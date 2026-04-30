"""
Chat agêntico com acesso a atestados, contratos, análises e pipeline.

Arquitetura:
  - Gemini 2.5 Flash com function calling (tools nativas via SDK)
  - Sem RAG / sem embeddings — o modelo decide inteligentemente
    quais ferramentas chamar e com quais argumentos
  - Histórico de mensagens passado pelo cliente (stateless no servidor)
  - 8 tools disponíveis, cada uma com validação de segurança embutida

Tools disponíveis:
  1. buscar_atestados        — busca atestados no BQ (keyword, mode, temporal)
  2. buscar_contratos_com_atestado — contratos com atestado formal documentado
  3. buscar_contratos_sem_atestado — contratos sem atestado (potencial para solicitar)
  4. buscar_certificacoes    — certificações vigentes por tema
  5. buscar_deals            — deals won/lost para contexto estratégico
  6. query_analises          — SELECT no BQ/lici_adk.analises_editais (somente SELECT)
  7. query_pipeline          — SELECT no Postgres / tabela editais (somente SELECT)
  8. listar_contas_com_atestado — contas que possuem atestado (para sugerir organs)
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal

import vertexai
from vertexai.generative_models import (
    Content,
    FunctionDeclaration,
    GenerationConfig,
    GenerativeModel,
    Part,
    Tool,
)
from google.cloud import bigquery

from backend.tools.bigquery_tools import (
    buscar_atestados as _buscar_atestados,
    buscar_contratos_com_atestado as _buscar_contratos_com,
    buscar_contratos_sem_atestado as _buscar_contratos_sem,
    buscar_certificacoes as _buscar_certs,
    buscar_deals_won as _deals_won,
    buscar_deals_lost as _deals_lost,
    BQ_PROJECT,
)
from backend.agents.persistor import DEST_PROJECT, DEST_DATASET, DEST_TABLE

log = logging.getLogger("lici_adk.chat")

REGION = os.getenv("VERTEX_REGION", "us-central1")

# ── BQ client reutilizado ─────────────────────────────────────────────────────
_BQ_ANALISES = f"`{DEST_PROJECT}.{DEST_DATASET}.{DEST_TABLE}`"
_BQ_ATESTADOS = f"`{BQ_PROJECT}.sales_intelligence.atestados`"
_BQ_CONTRATOS = f"`{BQ_PROJECT}.sales_intelligence.contratos`"
_ALLOWED_BQ_TABLES = {
    "analises_editais",
    "atestados",
    "contratos",
    "closed_deals_won",
    "closed_deals_lost",
    "certificados_xertica",
}
_SELECT_ONLY_RE = re.compile(
    r"^\s*(with\s|select\s)", re.IGNORECASE | re.MULTILINE
)
_DANGEROUS_RE = re.compile(
    r"\b(insert|update|delete|drop|truncate|merge|create|alter|grant|revoke|execute|exec|call|xp_|sp_)\b",
    re.IGNORECASE,
)

def _validate_sql(sql: str) -> str:
    """Levanta ValueError se o SQL não for SELECT-only."""
    if not _SELECT_ONLY_RE.match(sql.strip()):
        raise ValueError("Somente queries SELECT são permitidas")
    if _DANGEROUS_RE.search(sql):
        raise ValueError("SQL contém cláusula não permitida")
    return sql

def _inject_limit(sql: str, limit: int = 100) -> str:
    """Garante LIMIT se ausente."""
    if not re.search(r'\blimit\b', sql, re.IGNORECASE):
        sql = sql.rstrip(';') + f'\nLIMIT {limit}'
    return sql

# ── Serialização de resultados ────────────────────────────────────────────────
def _to_json(obj: Any, limit: int = 30) -> str:
    if isinstance(obj, list):
        items = obj[:limit]
        data = []
        for item in items:
            if hasattr(item, 'model_dump'):
                d = {k: v for k, v in item.model_dump().items() if v is not None}
            elif hasattr(item, '_asdict'):
                d = dict(item._asdict())
            else:
                d = dict(item) if hasattr(item, 'items') else str(item)
            data.append(d)
        result = {"count": len(obj), "items": data}
        if len(obj) > limit:
            result["truncated"] = True
    else:
        result = obj
    return json.dumps(result, ensure_ascii=False, default=str)

# ── Executor de tools ─────────────────────────────────────────────────────────
def _execute_tool(name: str, args: dict) -> str:
    try:
        if name == "buscar_atestados":
            kw = args.get("keyword", "")
            mode = args.get("mode", "like")
            meses = args.get("restricao_temporal_meses")
            limit = min(int(args.get("limit", 25)), 50)
            res = _buscar_atestados(kw, mode=mode, restricao_temporal_meses=meses, limit=limit)
            return _to_json(res)

        elif name == "buscar_contratos_com_atestado":
            kw = args.get("keyword", "")
            limit = min(int(args.get("limit", 20)), 50)
            res = _buscar_contratos_com(kw, limit=limit)
            return _to_json(res)

        elif name == "buscar_contratos_sem_atestado":
            kw = args.get("keyword", "")
            limit = min(int(args.get("limit", 20)), 50)
            res = _buscar_contratos_sem(kw, limit=limit)
            return _to_json(res)

        elif name == "buscar_certificacoes":
            kw = args.get("keyword", "")
            limit = min(int(args.get("limit", 50)), 100)
            res = _buscar_certs(kw, limit=limit)
            return _to_json(res)

        elif name == "buscar_deals":
            kw = args.get("keyword", "")
            tipo = args.get("tipo", "won")
            limit = min(int(args.get("limit", 20)), 40)
            if tipo == "lost":
                res = _deals_lost(kw, limit=limit)
            else:
                res = _deals_won(kw, limit=limit)
            return _to_json(res)

        elif name == "query_analises":
            sql = _validate_sql(args.get("sql", ""))
            sql = _inject_limit(sql, 100)
            client = bigquery.Client(project=DEST_PROJECT)
            job = client.query(sql)
            rows = [dict(r) for r in job.result()]
            return json.dumps({"count": len(rows), "items": rows[:80]}, ensure_ascii=False, default=str)

        elif name == "query_pipeline":
            raw = args.get("sql", "")
            # Postgres não tem backtick — remover para segurança
            sql = _validate_sql(raw.replace("`", '"'))
            sql = _inject_limit(sql, 100)
            import psycopg2, psycopg2.extras
            dsn = os.getenv("DATABASE_URL") or os.getenv("LICI_PG_DSN")
            if not dsn:
                return json.dumps({"error": "DATABASE_URL não configurado"})
            with psycopg2.connect(dsn) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(sql)
                    rows = [dict(r) for r in cur.fetchall()]
            return json.dumps({"count": len(rows), "items": rows[:80]}, ensure_ascii=False, default=str)

        elif name == "listar_contas_com_atestado":
            keyword = args.get("keyword", "")
            limit = min(int(args.get("limit", 50)), 100)
            client = bigquery.Client(project=BQ_PROJECT)
            params = [
                bigquery.ScalarQueryParameter("kw", "STRING", keyword),
                bigquery.ScalarQueryParameter("lim", "INT64", limit),
            ]
            where = ""
            if keyword:
                where = "WHERE LOWER(resumodoatestado) LIKE CONCAT('%', LOWER(@kw), '%') OR LOWER(objeto) LIKE CONCAT('%', LOWER(@kw), '%')"
            sql = f"""
                SELECT nomedaconta,
                       COUNT(*) AS total_atestados,
                       MAX(datadoatestado) AS atestado_mais_recente,
                       ARRAY_AGG(DISTINCT familia IGNORE NULLS LIMIT 5) AS familias,
                       ARRAY_AGG(resumodoatestado IGNORE NULLS LIMIT 3) AS resumos_amostra
                FROM {_BQ_ATESTADOS}
                {where}
                GROUP BY nomedaconta
                ORDER BY total_atestados DESC
                LIMIT @lim
            """
            job = client.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params))
            rows = []
            for r in job.result():
                d = dict(r)
                if "familias" in d and d["familias"]:
                    d["familias"] = list(d["familias"])
                if "resumos_amostra" in d and d["resumos_amostra"]:
                    d["resumos_amostra"] = list(d["resumos_amostra"])
                rows.append(d)
            return json.dumps({"count": len(rows), "items": rows}, ensure_ascii=False, default=str)

        else:
            return json.dumps({"error": f"tool desconhecida: {name}"})

    except ValueError as ve:
        return json.dumps({"error": str(ve)})
    except Exception as exc:
        log.error("chat.tool_error", extra={"tool": name, "error": str(exc)})
        return json.dumps({"error": f"Erro interno: {str(exc)[:200]}"})

# ── Tool declarations ─────────────────────────────────────────────────────────
_TOOLS = Tool(function_declarations=[
    FunctionDeclaration(
        name="buscar_atestados",
        description=(
            "Busca atestados de capacidade técnica que a Xertica possui. "
            "Use para responder sobre experiência comprovada, quais atestados existem, "
            "como comprovar um requisito, se um tipo de serviço tem atestado formal. "
            "Retorna: nomedaconta, objeto, resumodoatestado, familia, horas, datadoatestado, linkdeacesso."
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "Palavra-chave para busca (ex: 'GCP', 'Workspace', 'chatbot', 'inteligência artificial')"},
                "mode": {"type": "string", "enum": ["like", "strict", "familia"], "description": "like=substring, strict=palavra exata, familia=família Google"},
                "restricao_temporal_meses": {"type": "integer", "description": "Se o edital exige atestado dos últimos N meses"},
                "limit": {"type": "integer", "description": "Máximo de resultados (padrão 25, máximo 50)"},
            },
            "required": ["keyword"],
        },
    ),
    FunctionDeclaration(
        name="buscar_contratos_com_atestado",
        description=(
            "Busca contratos da Xertica que JÁ possuem atestado formal documentado. "
            "Use quando quiser saber quais contratos têm atestado para comprovar. "
            "Retorna: nomedaconta, objetodocontrato, resumodocontrato, atestado_linkdeacesso."
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "Tema do contrato"},
                "limit": {"type": "integer"},
            },
            "required": ["keyword"],
        },
    ),
    FunctionDeclaration(
        name="buscar_contratos_sem_atestado",
        description=(
            "Busca contratos da Xertica que NÃO possuem atestado formal. "
            "Use para identificar oportunidades: contratos onde a Xertica tem experiência "
            "real mas pode SOLICITAR um atestado ao órgão contratante para formalizar. "
            "Retorna: nomedaconta, objetodocontrato, resumodocontrato, statusdocontrato."
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["keyword"],
        },
    ),
    FunctionDeclaration(
        name="listar_contas_com_atestado",
        description=(
            "Lista QUAIS órgãos/contas possuem atestados da Xertica, agrupados por conta. "
            "Use quando a pergunta é 'para quais órgãos tenho atestado?', "
            "'quais clientes posso pedir atestado?' ou 'quais contas comprovam X?'. "
            "Retorna: nomedaconta, total_atestados, atestado_mais_recente, familias."
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "Filtrar por tema (opcional — deixar vazio para listar todas as contas)"},
                "limit": {"type": "integer", "description": "Número de contas (padrão 50)"},
            },
            "required": [],
        },
    ),
    FunctionDeclaration(
        name="buscar_certificacoes",
        description=(
            "Busca certificações técnicas vigentes de profissionais da Xertica. "
            "Use para responder se há pessoas certificadas num tema, quantas, quais. "
            "Retorna: full_name, certification, certification_subtype, expiration_date."
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "Tema da certificação (ex: 'Cloud', 'ML', 'Security')"},
                "limit": {"type": "integer"},
            },
            "required": ["keyword"],
        },
    ),
    FunctionDeclaration(
        name="buscar_deals",
        description=(
            "Busca deals ganhos ou perdidos para contexto estratégico. "
            "Use para: 'já ganhamos licitação de X?', 'por que perdemos Y?', "
            "'quais fatores de sucesso em IA?'. "
            "Retorna: conta, produtos, resumo_analise, fatores_sucesso, licoes_aprendidas."
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string"},
                "tipo": {"type": "string", "enum": ["won", "lost"], "description": "won=ganhos (padrão), lost=perdidos"},
                "limit": {"type": "integer"},
            },
            "required": ["keyword"],
        },
    ),
    FunctionDeclaration(
        name="query_analises",
        description=(
            "Executa SQL SELECT no BigQuery na tabela analises_editais. "
            "Schema: analysis_id, data_analise (TIMESTAMP), orgao (STRING), uf, modalidade, objeto, "
            "status (APTO/APTO COM RESSALVAS/INAPTO/NO-GO), score_aderencia (INT), "
            "bloqueio_camada_1, evidencias_count, valor_estimado (FLOAT), pipeline_ms (INT), "
            "edital_filename. Tabela completa: `operaciones-br.lici_adk.analises_editais`. "
            "Use para: estatísticas de análises, histórico por UF/órgão, scores médios, "
            "análises recentes, etc."
        ),
        parameters={
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "Query SELECT BigQuery SQL. Sempre incluir LIMIT."},
            },
            "required": ["sql"],
        },
    ),
    FunctionDeclaration(
        name="query_pipeline",
        description=(
            "Executa SQL SELECT no PostgreSQL na tabela editais (pipeline ativo). "
            "Schema: edital_id (UUID), orgao, uf, objeto, fase_atual "
            "(identificacao/analise/pre_disputa/proposta/disputa/habilitacao/recursos/homologado), "
            "estado_terminal (ganho/perdido/inabilitado/revogado/nao_participamos), "
            "score_comercial (NUMERIC), prioridade (1-5), vendedor_email, "
            "data_encerramento (TIMESTAMPTZ), criado_em, valor_estimado. "
            "Use para: editais no pipeline, quantos por fase, editais próximos do prazo, etc."
        ),
        parameters={
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "Query SELECT PostgreSQL. Sempre incluir LIMIT e WHERE deleted_at IS NULL."},
            },
            "required": ["sql"],
        },
    ),
])

# ── System prompt ─────────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """Você é o Assistente de Licitações da Xertica — especialista em habilitação técnica, atestados de capacidade técnica e estratégia comercial em licitações públicas brasileiras.

# Sua missão
Responder perguntas sobre:
- **Atestados que a Xertica possui** — quais clientes, quais serviços, como comprovar requisitos
- **Contratos com e sem atestado** — identificar oportunidades de formalizar comprovações
- **Órgãos para solicitar atestados** — quais ex-clientes pode-se pedir atestado retroativo
- **Análises históricas** — scores, aprovações, INAPTO, performance por UF/órgão
- **Pipeline atual** — editais em andamento, fases, prioridades
- **Deals ganhos/perdidos** — padrões de sucesso e fracasso
- **Estratégia de habilitação** — como construir portfólio de atestados para um tema

# Como usar as tools
1. **Sempre consulte os dados reais** antes de responder — não invente resultados
2. **Combine múltiplas tools** quando necessário (ex: buscar atestados + listar contas)
3. Para perguntas sobre "como provar X": use buscar_atestados + buscar_contratos_com_atestado + buscar_contratos_sem_atestado
4. Para "quais órgãos posso pedir atestado": use listar_contas_com_atestado + buscar_contratos_sem_atestado
5. Para perguntas analíticas/numéricas: use query_analises ou query_pipeline com SQL direto

# Formato de resposta
- Use **markdown**: negrito para nomes de clientes/órgãos, tópicos para listas
- Seja direto e objetivo
- Para atestados: sempre mencione o órgão/conta, objeto e data
- Para links de atestados: apresente como [ver atestado](url) quando disponível  
- Ao sugerir solicitação de atestado: seja específico sobre qual contrato, com quem falar
- Indique claramente se algo não existe nos dados

# Contexto técnico
- Xertica é uma empresa parceira Google Cloud (GCP, Workspace, IA)
- Atestados são documentos formais de capacidade técnica exigidos em licitações
- JOIN dos dados é feito via nomedaconta (cliente/órgão contratante)
- Dados em BigQuery: `operaciones-br.sales_intelligence.{atestados,contratos,closed_deals_won,...}`
- Dados de pipeline em PostgreSQL: tabela `editais`
- Análises históricas em BigQuery: `operaciones-br.lici_adk.analises_editais`
"""

# ── Agentic chat loop ─────────────────────────────────────────────────────────
def chat(
    messages: list[dict],
    max_tool_calls: int = 6,
) -> tuple[str, list[dict]]:
    """
    Executa o loop agêntico com function calling.

    Args:
        messages: histórico no formato [{role: 'user'|'assistant', content: '...'}]
        max_tool_calls: limite de iterações de tool use (segurança anti-loop)

    Returns:
        (resposta_texto, historico_atualizado)
    """
    vertexai.init(project=DEST_PROJECT, location=REGION)
    model = GenerativeModel(
        os.getenv("LICI_CHAT_MODEL", "gemini-2.5-flash"),
        system_instruction=_SYSTEM_PROMPT,
        tools=[_TOOLS],
        generation_config=GenerationConfig(
            temperature=0.1,  # baixo: respostas precisas sobre dados
            max_output_tokens=4096,
        ),
    )

    # Converter histórico para Content objects
    history: list[Content] = []
    for msg in messages[:-1]:  # tudo exceto a última mensagem (que vamos enviar)
        role = "user" if msg["role"] == "user" else "model"
        history.append(Content(role=role, parts=[Part.from_text(msg["content"])]))

    user_message = messages[-1]["content"]

    chat_session = model.start_chat(history=history)
    response = chat_session.send_message(user_message)

    tool_calls_made = 0
    while response.candidates[0].function_calls and tool_calls_made < max_tool_calls:
        tool_calls_made += 1
        tool_results = []
        for fc in response.candidates[0].function_calls:
            tool_name = fc.name
            tool_args = dict(fc.args)
            log.info("chat.tool_call", extra={"tool": tool_name, "args_keys": list(tool_args.keys())})
            result_json = _execute_tool(tool_name, tool_args)
            tool_results.append(
                Part.from_function_response(name=tool_name, response={"result": result_json})
            )
        response = chat_session.send_message(tool_results)

    text_response = response.candidates[0].content.parts[0].text.strip()

    # Atualizar histórico
    updated_history = list(messages) + [{"role": "assistant", "content": text_response}]

    return text_response, updated_history
