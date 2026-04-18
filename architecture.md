lici-adk — Agente de Análise de Licitações (Xertica)Visão GeralSistema multi-agente que lê editais de licitação pública brasileira, cruza com o histórico comercial da Xertica (atestados, contratos, deals ganhos/perdidos, certificações) e devolve um parecer de qualificação auditável (status + score + evidências + gaps + estratégia).Superfícies de uso:

Web App Next.js (Fase 5) — interface principal com upload de PDF, histórico e parecer renderizado
API FastAPI — mesma API que o web consome, também acessível via curl/Python para integrações
Tudo roda em um único projeto GCP: operaciones-br (Amália é Owner). Zero dependência de outros projetos para execução.Fora de escopo: Agentspace, Gemini Enterprise Extensions, Agent Engine, A2A, MCP, Looker Studio, Firestore cache, webhook Trello.Projeto GCPProjetoPapelAcesso Amáliaoperaciones-brRuntime único — Cloud Run (backend + web), Vertex AI, BigQueryOwnerRegion padrão: us-central1 (Gemini 2.5 Pro disponível, custo baixo).
Nota histórica: um deploy anterior do backend foi feito em xertica-gen-ai-br. Está abandonado. A Amália não tem run.invoker lá e essa dependência foi eliminada ao trazer tudo pra operaciones-br.

Nota de coexistência: existe em projects/operaciones-br/locations/us-central1/reasoningEngines/2395489490761154560 um reasoning engine chamado "Motor Assistente Xertica v1" criado por outro time. Não pertence ao lici-adk e não deve ser sobrescrito.
Arquitetura┌──────────────────────────────────────────────────────────────────────┐
│  Browser (usuário @xertica.com)                                       │
│  ── Google OAuth (NextAuth) → Google ID token                         │
└──────────────┬───────────────────────────────────────────────────────┘
               │  HTTPS + Authorization: Bearer <id_token>
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  lici-adk-web (Next.js 14 · Cloud Run · operaciones-br/us-central1)   │
│  ── SSR de /, /analises, /analises/[id]                               │
│  ── Chama lici-adk-backend via service-to-service (ID token)          │
└──────────────┬───────────────────────────────────────────────────────┘
               │  HTTPS autenticado via IAM
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  lici-adk-backend (FastAPI · Cloud Run · operaciones-br/us-central1)  │
│  ── POST /analyze (upload PDF, retorna analysis_id em ~1s)            │
│  ── GET  /analyze/{id} (polling de status)                            │
│  ── GET  /analyses (lista histórica filtrável)                        │
│  ── GET  /analyses/{id} (detalhe do parecer persistido)               │
│  ── GET  /healthz                                                     │
│                                                                        │
│  Middleware: valida Google ID token, exige email @xertica.com         │
│                                                                        │
│  Pipeline (google-adk · SequentialAgent — Fase 2):                    │
│  ┌─────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐        │
│  │Extrator ├──▶│ Qualificador ├──▶│ Analista ├──▶│Persistor │        │
│  └─────────┘   └──────────────┘   └──────────┘   └──────────┘        │
│     Flash         Flash+tools         Pro           (BQ insert)       │
└───┬─────────────────┬─────────────────────────────────┬───────────────┘
    │ Vertex AI       │ BigQuery (leitura)              │ BigQuery (escrita)
    ▼                 ▼                                 ▼
┌─────────────┐   ┌───────────────────────────────┐   ┌──────────────────┐
│ Gemini 2.5  │   │ operaciones-br                │   │ operaciones-br   │
│ Flash / Pro │   │  .sales_intelligence          │   │  .lici_adk       │
│             │   │   ├─ atestados (138)          │   │   .analises_     │
│             │   │   ├─ contratos (185)          │   │     editais      │
│             │   │   ├─ closed_deals_won (582)   │   │                  │
│             │   │   ├─ closed_deals_lost (2.173)│   │                  │
│             │   │   └─ certificados_xertica     │   │                  │
│             │   │      (1.085 válidos)          │   │                  │
│             │   └───────────────────────────────┘   └──────────────────┘
└─────────────┘Princípios:

Um projeto só — zero IAM cross-project
Pipeline ADK na Fase 2 — prompts literalmente iguais ao MVP validado
Auth end-to-end Google — NextAuth no front, ID token até o backend, @xertica.com obrigatório
Stateful só no BigQuery — sem Firestore/Redis/fila; jobs in-flight em memória (redeploy perde, aceitável no MVP)
Fonte de Dadosoperaciones-br.sales_intelligenceatestados
CampoTipoUsoid, nomedaconta, objetoSTRINGIdentificaçãoresumodoatestadoSTRINGTexto rico para busca semânticafamiliaSTRINGCategoria (GCP, Google Workspace, Serviços GCP, MVPs IA)origem, valor, horas, totaldehoras, aceleradorSTRING/FLOATMetadadosdatadoatestadoSTRINGReferência temporallinkdeacessoSTRINGLink para o PDF originalnrodocontratoSTRINGChave de join teórica (frequentemente NULL)contratos
CampoTipoUsonomedaconta, objetodocontratoSTRINGIdentificaçãoresumodocontrato, detalhamentoservicosSTRINGTexto rico — descreve o que foi feitoaceleradores, statusdocontrato, valordocontratoSTRING/FLOATMetadadosduracaodocontratoemquantidadedemeses, estadoFLOAT/STRINGContextonumerodocontratoSTRINGChave teórica (frequentemente NULL)tipodecontrato, modalidadedecontratoSTRINGPregão, Adesão, Direto
Join efetivo: LOWER(TRIM(atestados.nomedaconta)) = LOWER(TRIM(contratos.nomedaconta)). Campos numerodocontrato e tematestado são NULL em praticamente todos os registros — não usar.
closed_deals_won / closed_deals_lost
Oportunidades já analisadas por IA.Campos principais: Conta, Oportunidade, Produtos, Familia_Produto, Resumo_Analise, Fatores_Sucesso / Causa_Raiz, Licoes_Aprendidas, Vertical_IA, Gross, Net, Data_Fechamento.
Uso de closed_deals_lost: se ≥ 3 deals perdidos no mesmo Familia_Produto ou com mesma Causa_Raiz, o Analista rebaixa score e inclui alerta.
certificados_xertica
1.090 registros; 1.085 válidos em 17/04/2026.CampoTipoUsocert_id, certificationSTRINGBusca por keywordcertification_type / certification_subtypeSTRINGBusiness vs Technicalfull_name, emailSTRINGProfissionalexpiration_dateDATEFiltro >= CURRENT_DATE()Top certificações técnicas: Professional Cloud Architect (13), Associate Cloud Engineer (14), Professional ML Engineer (7), Professional Data Engineer (7), Generative AI Leader (8), Google Workspace Deployment Technical Credential (26).operaciones-br.lici_adk.analises_editais (escrita)Criada automaticamente pelo Persistor na primeira execução. Particionada por data_analise, clusterizada por [status, orgao, uf].Campos: analysis_id, data_analise, orgao, uf, uasg, objeto, status, score_aderencia, bloqueio_camada_1, estrategia, alertas_json, gaps_json, evidencias_count, campos_trello_json, pdf_hash_md5, pipeline_ms, flags booleanas do edital.Idempotente: INSERT OR IGNORE por analysis_id.Perfil XerticaDados estáticos em backend/xertica_profile.yaml — injetados no system prompt do Analista.Especializações Google reconhecidas
Government · Work Transformation · Vertex AI · AppSheet · Google Cloud Productivity · ML & ML APIs · MLOps.Realidade Contratual (peso alto — fatos do BigQuery)

GWS (46 contratos) / GCP + GWS (18) / GCP (11) — carro-chefe
Aceleradores reais: Meet Transcriber (8×), Video Transcript, X-Bot, VCC, Doc Intelligence
Modalidades reais: Contrato Público direto (48), Adesão a Ata (27), ARP (4)
Unidades de edital: USN, UST, licenças, créditos, bolsa de horas, tickets
Narrativa GTM (peso baixo — só argumento, não "produto")
FDM (Fair Decision Making) — IA agêntica com camada ontológica + multi-agente. Verticais MP/TJ/SEFAZ/SEPLAN/SEMA.
Xertica GIS — Google Maps + Earth Engine.
⚠️ FDM/"Camada Ontológica"/"Multi-agente" não aparecem nominalmente em nenhum dos 175 contratos reais. Analista usa FDM apenas como argumento de diferenciação em editais de IA agêntica/ontologia/triagem processual — nunca como produto concreto.
Pipeline — 4 AgentesOrquestrados via google-adk (SequentialAgent + LlmAgent + FunctionTool) a partir da Fase 2. Prompts ficam literalmente iguais ao MVP validado.Agente 1 — Extrator (gemini-2.5-flash)Input: PDF do edital (bytes, multimodal nativo do Gemini).
Output: EditalEstruturado (Pydantic).Identificação: objeto, orgao (+ estado + UASG), modalidade, data_encerramento, prazo_questionamento, duracao_contrato, valor_estimado, portal.Requisitos: requisitos_tecnicos, requisitos_habilitacao, garantia_contratual, nivel_parceria_exigido, certificacoes_corporativas_exigidas (ISO 27001/17/18/701, SOC, PCI-DSS), certificacoes_profissionais_exigidas, volumetria_exigida ({dimensao, quantidade, unidade}).Modelo comercial: modelo_precificacao (USN/USNM/UST/USTc/USTa/licenca_fixa/consumo_volumetria/bolsa_horas/tickets), tabela_proporcionalidade_ust, nivel_sla_critico, penalidades_glosa_max_pct.Flags Go/No-Go: exclusividade_me_epp, vedacao_consorcio, subcontratacao_permitida, exige_poc_mvp, prazo_poc, modelo_inovacao_etec, restricao_temporal_experiencia_meses, localizacao_dados_exigida, dependencias_terceiros_identificadas, strict_match_atestados.Agente 2 — Qualificador (gemini-2.5-flash + FunctionTools)Input: requisitos do Extrator.
Tools BigQuery: buscar_atestados, buscar_contratos_com_atestado, buscar_contratos_sem_atestado, buscar_deals_won, buscar_deals_lost, buscar_certificacoes.Modos avançadosa) strict_match=True — edital veda similares (Celepar). REGEXP_CONTAINS ancorado por \b.a.2) match_familia=True — edital pede "parceiro Google" sem nomear produto. Casa por familia IN ('GCP', 'Google Workspace', 'Serviços GCP', 'MVPs IA').b) Filtro temporal — restricao_temporal_experiencia_meses (ex: Celepar 36m) via SAFE.PARSE_DATE + DATE_SUB.c) Filtro de volumetria — LLM lê resumodoatestado e extrai {quantidade, unidade}. Comparar com volumetria_exigida.
⚠️ Marcar como "indicativa — revisar manualmente" até dry-run com ≥ 10 atestados reais validados (formatos inconsistentes: "400 usuários", "quatrocentas contas", "licenças para 400 pessoas").
d) Filtro por segmento — regex em nomedaconta: (ministério público|mp[a-z]{2}|tribunal|tj[a-z]{2}|tre|trt|stj|cnj|agu|pge|defensoria).e) Perfis especializados — regex em certification: (machine learning|ml engineer|data engineer|cloud architect|finops|security).Prioridade de evidência

Contratos com atestado vinculado (comprovação direta)
Contratos sem atestado mas com resumodocontrato rico (base para solicitar)
Deals ganhos (experiência adicional)
Certificações válidas (reforço técnico)
Instrumentação (sem bloquear MVP)
Logar {contrato_id, nomedaconta, matches_count} quando JOIN retornar 0 matches para contrato Encerrado > R$ 500k, ou ≥ 2 matches (suspeita de duplicata). Acumula dataset "contas que precisam de normalização" sem exigir tabela canônica de aliases agora.Agente 3 — Analista (gemini-2.5-pro)Input: EditalEstruturado + QualificadorResult + xertica_profile.yaml.
Output: ParecerFinal com:

score_aderencia — 0-100 ou null se Camada 1 bloquear
status — APTO / APTO COM RESSALVAS / INAPTO / NO-GO
bloqueio_camada_1 — string identificando qual regra disparou (null se Camada 2 rodou)
requisitos_atendidos
evidencias_por_requisito — auditáveis: {requisito, fonte_tabela, fonte_id, trecho_literal, tipo_evidencia, confianca}
gaps — com delta numérico em volumetria
estrategia, alertas, campos_trello
Lógica de Decisão em duas camadasCamada 1 — Bloqueadores duros (short-circuit ANTES do score):

exclusividade_me_epp=true → NO-GO
Consórcio obrigatório → NO-GO
localizacao_dados_exigida fora de southamerica-* → INAPTO
Certificação corporativa mandatória ausente (ex: ISO 27001) → INAPTO
Zero atestados E zero contratos + atestado é habilitação mandatória → INAPTO
Nível de parceria exigido > confirmado no YAML → INAPTO
Se qualquer item disparar: score_aderencia=null, bloqueio_camada_1 preenchido, parecer explica o bloqueio.Camada 2 — Score 0-100 (só se Camada 1 passar):

Cobertura técnica por atestados + contratos + deals_won (peso principal)
Match com realidade_contratual.objetos_mais_comuns e contratos_ia_ancora
Aderência a especializacoes_google
Adesão a Ata viável
Premier Partner como reforço
Padrões de perda como penalidade
Status: APTO ≥75, APTO COM RESSALVAS 41-74, INAPTO ≤40.
Princípio: status é função determinística (Camada 1 → Camada 2). LLM argumenta; binário "pode participar?" segue a árvore.
Chain-of-Thought no prompt
Go/No-Go pelas flags (ME/EPP, consórcio, subcontratação)
Dicionário de unidades: USN ≡ USNM ≡ Créditos GCP ≡ Consumo Cloud; UST ≈ USTc ≈ USTa ≈ hora técnica base
UST → FTE: total × proporcionalidade / (160h × meses). Ex: Banestes 47k / 24m ≈ 12 FTE; Celepar 30k / 24m ≈ 8 FTE
ETEC / Marco Legal das Startups: termos "ETEC", "Inovação", "caixa branca", "IA explicável" → recomendar narrativa FDM
Risco de glosa: penalidades_glosa_max_pct ≥ 20% OU SLA agressivo → alerta "ALTO RISCO DE GLOSA"
Data residency + ISO: validar contra certidoes_empresa do YAML
Dependências de terceiros: WhatsApp Business API, sistemas legados, APIs governamentais → alertar
Premier Partner: se exigido e confirmado → somar pontos + citar Carta de Credenciamento Google
Adesão a Ata oportunística: órgão em histórico de Ata → sugerir Adesão antes de pregão
Fallback vazio: zero evidência → não alucinar, status ≤ APTO COM RESSALVAS, score ≤ 40, gaps explícito
Certidões — guard-rail
Tool do Qualificador validar_certidoes cruza SICAF, CNDs, FGTS/CRF, CNDT, CADIN, CAGEF, CEIS/CNEP contra certidoes_empresa do YAML.

Todas válidas → sem impacto
≥ 1 vencida/null → APTO COM RESSALVAS + alerta de renovação
Crítica ausente + abertura < 5 dias úteis → alerta_critico

Fase 3+: integrar com fonte oficial (SICAF API, Trello). Hoje o YAML carrega placeholders null.
Agente 4 — Persistor (BQ insert, sem LLM)Input: ParecerFinal + EditalEstruturado + metadados (pdf_hash_md5, pipeline_ms, edital_filename).
Output: linha em operaciones-br.lici_adk.analises_editais.
Falha silenciosa: BQ indisponível não aborta a resposta ao usuário
_ensure_table() cria dataset+tabela se não existir
INSERT OR IGNORE por analysis_id → replay seguro
Contrato da APIMétodoRotaComportamentoPOST/analyzeUpload PDF, retorna {analysis_id, status: "queued"} em ~1sGET/analyze/{id}Polling. status = queued → running → done / error, com current_agentGET/analysesLista histórica. Filtros: orgao, status, uf, since, limitGET/analyses/{id}Detalhe do parecer persistidoGET/healthzHealth check públicoAuth: todos os endpoints exceto /healthz exigem Authorization: Bearer <google_id_token>. Middleware valida assinatura Google e email.endswith("@xertica.com").Fluxo de Uso1. Usuário acessa o web app, faz login com @xertica.com, envia PDF
2. Web chama POST /analyze → backend retorna analysis_id em ~1s
3. Extrator       (10-20s, depende do PDF)
4. Qualificador   (5-10s)
5. Analista       (15-30s)
6. Persistor      (1-2s, silencioso)
7. Frontend faz polling em GET /analyze/{id}, renderiza parecer quando doneTotal: 30-60s. Editais de 60-100 páginas podem chegar a 2-3 min. UI comunica "até 3 minutos".Frontend — Web AppStack: Next.js 14 App Router · TypeScript · Tailwind · shadcn/ui · NextAuth (Google Provider).Páginas:
RotaFunção/Upload de PDF (drag-drop) + polling + parecer renderizado inline/analisesHistórico do BQ com filtros (órgão, status, UF, data)/analises/[id]Parecer completo — compartilhável, exportável como PDFIdentidade visual: paleta e tipografia extraídas dos decks em XerticaProducts/*.pptx (Fase 5).Auth: NextAuth Google Provider com hd=xertica.com. ID token viaja no header para o backend. Sem backend de sessão — stateless.Deploy: Cloud Run lici-adk-web em operaciones-br/us-central1. IAM run.invoker para @xertica.com.DeployBackend
bashgcloud builds submit \
  --project=operaciones-br \
  --tag=gcr.io/operaciones-br/lici-adk-backend

gcloud run deploy lici-adk-backend \
  --project=operaciones-br \
  --region=us-central1 \
  --image=gcr.io/operaciones-br/lici-adk-backend \
  --no-allow-unauthenticated \
  --set-env-vars=GCP_PROJECT=operaciones-br,VERTEX_LOCATION=us-central1

gcloud run services add-iam-policy-binding lici-adk-backend \
  --project=operaciones-br \
  --region=us-central1 \
  --member='user:amalia.silva@xertica.com' \
  --role='roles/run.invoker'Web
bashcd web
gcloud builds submit --project=operaciones-br --tag=gcr.io/operaciones-br/lici-adk-web

gcloud run deploy lici-adk-web \
  --project=operaciones-br \
  --region=us-central1 \
  --image=gcr.io/operaciones-br/lici-adk-web \
  --no-allow-unauthenticated \
  --set-env-vars=BACKEND_URL=<cloud_run_backend_url>,NEXTAUTH_URL=<web_url>IAM — Default Compute Service AccountSA de operaciones-br: <PROJECT_NUMBER>-compute@developer.gserviceaccount.com.RecursoRoleStatusPara quêoperaciones-brroles/aiplatform.user⏳ Fase 3Vertex AI (Gemini)operaciones-br.sales_intelligenceroles/bigquery.dataViewer + jobUser✅ 2026-04-17Qualificador lêoperaciones-br.lici_adkroles/bigquery.dataEditor✅ 2026-04-17Persistor escreveComandos executados em 2026-04-17 estão documentados no Pre-flight Checklist.Estrutura do Repositóriolici-adk/
├── backend/
│   ├── agents/
│   │   ├── extrator.py            # Gemini 2.5 Flash lê PDF
│   │   ├── qualificador.py        # BQ queries (6 tools)
│   │   ├── analista.py            # Gemini 2.5 Pro + YAML
│   │   ├── persistor.py           # BQ insert
│   │   └── orchestrator.py        # Fase 1: Python puro / Fase 2: SequentialAgent ADK
│   ├── tools/
│   │   └── bigquery_tools.py      # funções puras; FunctionTool wrappers na Fase 2
│   ├── models/schemas.py          # Pydantic (EditalEstruturado, QualificadorResult, ParecerFinal, Evidencia)
│   ├── main.py                    # FastAPI + auth middleware
│   ├── logging_config.py          # JSON structured logs
│   ├── xertica_profile.yaml       # perfil injetado no Analista
│   └── requirements.txt
├── web/                           # Next.js (Fase 5)
├── scripts/                       # smoke tests
├── notebooks/                     # exploração
├── XerticaProducts/               # decks (fonte visual + narrativa FDM)
├── Dockerfile
└── ARCHITECTURE.mdDecisões de ArquiteturaDecisãoEscolhaMotivoProjeto únicooperaciones-brAmália é Owner — zero dependência de admin externoBackend antigo em xertica-gen-ai-brAbandonadorun.invoker bloqueado sem admin; redeploy em operaciones-br elimina problemaOrquestraçãoPython puro no MVP → ADK (SequentialAgent) na Fase 2Valida qualidade do parecer primeiro; ADK depois pra arquitetura canônica e roadmap futuroPromptsInalterados entre MVP e Fase 2Garantir que só a estrutura muda; comparação pareada para detectar regressãoDataset BQsales_intelligence (leitura) + lici_adk.analises_editais (escrita)Fonte consolidada + histórico particionadoJOIN atestados↔contratosLOWER(TRIM(nomedaconta))numerodocontrato NULL na maioria; validado dry-runtematestado ignoradoNULL em 100% dos contratosDescoberto no dry-runRegionus-central1Gemini 2.5 Pro disponível; custo baixoLLMsFlash (extração + tools) / Pro (analista)Flash rápido e barato; Pro para raciocínio profundoclosed_deals_lostIncluídoEvita recomendar participação com padrão histórico de perdaFramework webNext.js 14 App RouterSSR + NextAuth maduro + API routesAuthGoogle OAuth via NextAuth (hd=xertica.com)ID token validado no backend; statelessJobs in-flightMemória do FastAPIMVP simples; redeploy perde jobs rodando — aceitávelPersistência de análisesBigQuery particionadoFonte única para histórico, analytics, frontendWeb app customSimControle total da UX, identidade Xertica; substitui ideia anterior de LookerFora de escopo: Agentspace, Gemini Enterprise Extensions, Agent Engine, A2A, MCP, Looker Studio, Firestore cache,


RoadmapFase 1 — Validar motor atual (Python puro) ⏳ EM ANDAMENTO
Rodar pipeline atual em dois PDFs reais. Não avançar sem aprovação qualitativa explícita.
 Extrator, Qualificador, Analista, Persistor implementados (Python puro)
 FastAPI com /analyze assíncrono e job store em memória
 BigQuery roles configuradas em operaciones-br
 E2E PRODESP: APTO COM RESSALVAS, score 63, 153s, 8 evidências auditáveis
 E2E Celepar (exercita strict_match=True, restrição temporal 36m, glosa 50%)
 Avaliação qualitativa dos 2 pareceres — gate para Fase 2
Fase 2 — Refactor para ADK
Migrar orchestrator.py de Python puro para SequentialAgent(google-adk), mantendo prompts literalmente iguais.
 LlmAgent para cada um dos 4 agentes
 FunctionTool para queries BQ e persistência
 Rerodar os 2 PDFs pós-refactor, comparar pareceres (divergência significativa = investigar)
 Aprovação antes de Fase 3
Fase 3 — Deploy em operaciones-br

 Build gcr.io/operaciones-br/lici-adk-backend
 Deploy Cloud Run com roles/aiplatform.user na SA
 run.invoker para Amália
 E2E via HTTP real (não mais local)
 Endpoints /analyses e /analyses/{id} com auth middleware
Fase 4 — Frontend Next.js

 Scaffold web/ (Next.js 14 + shadcn/ui + NextAuth)
 Extrair paleta/tipografia dos .pptx em XerticaProducts/
 Páginas /, /analises, /analises/[id]
 Deploy em Cloud Run operaciones-br
Fase 5 — Admin / Observabilidade (V2)

 Dashboard de monitoramento (latência p50/p95, taxa APTO, tokens consumidos)
 Visualização de pipeline por análise (React Flow)
 Logs streaming (Cloud Logging API → SSE)
 Replay/reexecução passo-a-passo
Fase 6 — Inteligência expandida

 Human-in-the-loop (feedback do time de licitações ajusta prompt do Analista)
 Integrar certidoes_empresa com SICAF API
 Cache de análises por hash do PDF
 Alertas proativos (edital com score alto no PNCP)
 Geração de minuta de proposta (Agente 5, alto esforço)
Política de PDFs
Limite multimodal Gemini 2.5 Flash: ~1.000 páginas ou 50 MB por request
Limite prático do MVP: 30 MB
Editais > 30 MB: pré-processar com OCR por capítulo (Fase 6)
Pre-flight ChecklistExecutado em 2026-04-17. Todos os itens ✅.1. BigQuery access (SA default de operaciones-br)
bashPROJECT_NUM=$(gcloud projects describe operaciones-br --format='value(projectNumber)')
SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding operaciones-br \
  --member="serviceAccount:$SA" \
  --role="roles/bigquery.dataViewer" --condition=None

gcloud projects add-iam-policy-binding operaciones-br \
  --member="serviceAccount:$SA" \
  --role="roles/bigquery.jobUser" --condition=None

gcloud projects add-iam-policy-binding operaciones-br \
  --member="serviceAccount:$SA" \
  --role="roles/bigquery.dataEditor" --condition=None
Sempre --condition=None para evitar herdar condições pré-existentes (ex: developer-connect-connection-setup com expiração).
2. Vertex AI em us-central1
bashcurl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/operaciones-br/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent" \
  -d '{"contents":[{"role":"user","parts":[{"text":"ping"}]}]}'
# Retornou candidates["Pong!..."] — OK3. APIs habilitadas
bashgcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  bigquery.googleapis.com \
  --project=operaciones-br4. Sanity check BigQuery
bashbq query --project_id=operaciones-br --use_legacy_sql=false \
  'SELECT COUNT(*) AS total FROM `operaciones-br.sales_intelligence.atestados`'
# 138 atestados