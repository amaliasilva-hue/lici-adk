-- Views analíticas do Copilot (xerticaproc)
-- Source dataset: xerticaproc_analytics (BigQuery)
-- Tables esperadas (carregadas via Datastream do Postgres ou export):
--   contratacoes, documentos_gerados, aprovacoes, eventos_contratacao,
--   conversas, mensagens, fontes_usuario.

-- ─── Funil ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `${PROJECT}.xerticaproc_analytics.v_funil_contratacoes` AS
SELECT
  c.id                         AS contratacao_id,
  c.orgao_id,
  c.criado_em,
  TIMESTAMP_DIFF(MAX(d.gerado_em), c.criado_em, HOUR)  AS horas_ate_etp,
  COUNTIF(d.doc_type = 'etp')         AS qtd_etp,
  COUNTIF(d.doc_type = 'tr')          AS qtd_tr,
  COUNTIF(d.doc_type = 'mapa_precos') AS qtd_mapa,
  COUNTIF(a.decisao = 'aprovado')     AS qtd_aprovacoes,
  COUNTIF(a.decisao = 'retorno')      AS qtd_retornos,
  COUNTIF(a.decisao = 'rejeitado')    AS qtd_rejeicoes
FROM `${PROJECT}.xerticaproc_analytics.contratacoes` c
LEFT JOIN `${PROJECT}.xerticaproc_analytics.documentos_gerados` d ON d.contratacao_id = c.id
LEFT JOIN `${PROJECT}.xerticaproc_analytics.aprovacoes`        a ON a.contratacao_id = c.id
GROUP BY 1,2,3;

-- ─── Tempo médio por etapa ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW `${PROJECT}.xerticaproc_analytics.v_tempo_medio_etapa` AS
WITH etapas AS (
  SELECT
    contratacao_id, doc_type,
    MIN(gerado_em) AS primeiro,
    MAX(gerado_em) AS ultimo,
    COUNT(*)       AS versoes
  FROM `${PROJECT}.xerticaproc_analytics.documentos_gerados`
  GROUP BY 1,2
)
SELECT
  doc_type,
  AVG(versoes) AS versoes_medias,
  AVG(TIMESTAMP_DIFF(ultimo, primeiro, HOUR)) AS horas_revisao_media
FROM etapas
GROUP BY 1;

-- ─── Taxa de aprovação na primeira tentativa ────────────────────────────────
CREATE OR REPLACE VIEW `${PROJECT}.xerticaproc_analytics.v_aprovacao_primeira` AS
WITH primeira AS (
  SELECT
    contratacao_id, documento_id,
    ROW_NUMBER() OVER (PARTITION BY documento_id ORDER BY criado_em ASC) AS rn,
    decisao
  FROM `${PROJECT}.xerticaproc_analytics.aprovacoes`
)
SELECT
  COUNT(*)                                              AS total,
  COUNTIF(decisao = 'aprovado')                         AS aprovadas_primeira,
  SAFE_DIVIDE(COUNTIF(decisao = 'aprovado'), COUNT(*))  AS taxa_primeira
FROM primeira
WHERE rn = 1;

-- ─── Origem das fontes de preço ─────────────────────────────────────────────
CREATE OR REPLACE VIEW `${PROJECT}.xerticaproc_analytics.v_fontes_origem` AS
SELECT
  classificacao,
  status_validacao,
  COUNT(*) AS qtd,
  AVG(valor_total / NULLIF(quantidade,0) / NULLIF(vigencia_meses,0)) AS valor_un_mes_medio
FROM `${PROJECT}.xerticaproc_analytics.fontes_usuario`
GROUP BY 1,2;

-- ─── Volume conversacional ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW `${PROJECT}.xerticaproc_analytics.v_chat_volume` AS
SELECT
  DATE(criado_em) AS dia,
  contratacao_id,
  COUNTIF(role = 'user')      AS msgs_user,
  COUNTIF(role = 'assistant') AS msgs_assistant
FROM `${PROJECT}.xerticaproc_analytics.mensagens`
GROUP BY 1,2;
