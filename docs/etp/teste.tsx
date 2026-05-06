Entrada:{objeto_da_contratacao}{requisitos_tecnicos}{prazo_estimado}{quantidades}{órgão}{restrições}Saída:- queries sugeridas- filtros- entidades a extrair- riscos de comparação- campos necessários para mapa de preços
Esse agente não decide sozinho. Ele monta o plano, consulta o banco e entrega um pacote de evidências.
3. Busca aprofundada de preços e produtos
A busca de preço precisa ser tratada como um produto próprio dentro da plataforma.
Fontes prioritárias:


PNCP: editais, atas, contratos, planos de contratação e documentos. O PNCP disponibiliza APIs para consultar informações como itens do PCA, contratos e atas de registro de preço. 


Compras.gov.br / Dados Abertos: dados em CSV/JSON e APIs para análise e cruzamento. 


Painel de Preços: compras homologadas no Compras.gov.br, útil para transparência e tomada de decisão. 


Portais estaduais e municipais.


Contratos e atas de órgãos semelhantes.


Fabricantes e distribuidores, mas como fonte complementar ou cotação formal.


Propostas comerciais anexadas pelo usuário.


Histórico interno de contratações.


Pipeline de preços:
Coleta → Extração → Normalização → Deduplicação → Comparabilidade → Cálculo → Evidência → Mapa de preços
A normalização é essencial. O sistema precisa saber que:
R$ 5.000 por usuário por 36 meses≠R$ 5.000 por usuário por 12 mesesUST≠hora técnica≠ponto de função≠pacote fechadolicença≠suporte≠implantação≠crédito de nuvem
Eu criaria um índice de comparabilidade, algo como:
Score de comparabilidade =   objeto similar+ mesmo fabricante/SKU+ mesma vigência+ mesma unidade de medida+ mesma escala de quantidade+ mesma modalidade+ mesma composição de suporte+ fonte oficial- divergência de escopo- ausência de documento- preço sem memória de cálculo
Resultado para o ETP/TR:
Referência 1 — alta comparabilidadeReferência 2 — média comparabilidadeReferência 3 — baixa comparabilidade, usada apenas como sensibilidadeReferências descartadas — com justificativaPreço estimado recomendadoMétodo de cálculoMemória de normalizaçãoRiscos da estimativa
Esse ponto conversa diretamente com a preocupação que aparece nos materiais recentes de modelagem: mapa de preços precisa priorizar referências públicas verificáveis, como ARPs, pregões, empenhos e publicações oficiais, descartando referências sem rastreabilidade documental quando necessário. 
4. Agentes principais do sistema
Eu organizaria em agentes especializados:
1. Agente de demanda / DFD
Entrada: conversa com usuário, DFD, e-mails, atas, histórico.
Saída:


problema público;


objetivo da contratação;


unidade demandante;


resultados esperados;


restrições;


premissas;


dependências;


alinhamento com PCA/PDTIC.


2. Agente de decomposição do objeto
Transforma uma demanda genérica em itens contratáveis:
Objeto: plataforma de IA corporativaItens possíveis:- licenças de uso- créditos de nuvem- serviços técnicos- suporte- treinamento- sustentação inicial- governança- integrações
Ele também alerta sobre risco de direcionamento, especificação excessiva ou item sem preço público verificável.
3. Agente de mercado
Pesquisa alternativas:
Solução A — plataforma corporativa integradaSolução B — contratação de desenvolvimento sob demandaSolução C — múltiplas ferramentas isoladasSolução D — manutenção do cenário atual
Saída:


matriz de alternativas;


vantagens;


desvantagens;


riscos;


custo estimado;


justificativa da solução escolhida.


4. Agente de preços
É o mais importante operacionalmente.
Funções:


consultar PNCP;


consultar Compras.gov;


buscar atas;


buscar contratos;


extrair itens;


normalizar vigência;


separar licença/serviço/suporte;


detectar outlier;


sugerir preço de referência;


gerar mapa de preços;


gerar memória de cálculo.


5. Agente técnico
Monta requisitos técnicos suficientes, sem exagerar:


requisitos funcionais;


requisitos não funcionais;


segurança;


integração;


suporte;


escalabilidade;


interoperabilidade;


níveis de serviço;


critérios de aceite.


6. Agente jurídico/normativo
Valida aderência a:


Lei nº 14.133/2021;


IN SGD/ME nº 94/2022;


LGPD;


Marco Civil, quando envolver internet/dados;


modelos padronizados;


regras internas do órgão.


7. Agente de riscos
Gera matriz de riscos:


risco de preço inexequível;


baixa comparabilidade de fontes;


lock-in;


dependência de fornecedor;


privacidade;


indisponibilidade;


integração;


adoção baixa;


consumo de nuvem sem controle;


impugnação por direcionamento.


8. Agente redator de ETP/TR
Só escreve com base em:
dados estruturados + evidências + decisões aprovadas + templates
Não pode inventar fonte, preço ou requisito.
9. Agente revisor/auditor
Confere:


se toda afirmação técnica tem evidência;


se todo preço tem fonte;


se o TR está coerente com o ETP;


se a solução escolhida decorre do levantamento de mercado;


se os critérios de aceite são mensuráveis;


se há risco de especificação restritiva.


5. Stack GCP recomendada
Frontend


React/Next.js ou Angular.


Hospedagem em Cloud Run.


Login com Identity-Aware Proxy, Google Identity ou integração com IdP do órgão.


Interface com wizard por etapa: DFD → ETP → Pesquisa de preço → TR → Revisão → Exportação.


O Cloud Run é adequado porque executa frontends, backends, jobs e filas sem gerenciar infraestrutura. 
Backend


Cloud Run para APIs e microsserviços.


Workflows para orquestrar etapas longas: coleta, extração, validação, geração e revisão.


Pub/Sub para eventos.


Cloud Tasks para filas controladas e rate limit.


Cloud Scheduler para pesquisas recorrentes.


Workflows é uma plataforma gerenciada para orquestrar serviços em uma ordem definida, combinando Cloud Run, funções, serviços Google Cloud e APIs HTTP externas. 
IA e agentes


Vertex AI / Gemini para geração e análise.


Gemini Enterprise Agent Platform / ADK para agentes e fluxos multiagente.


Agent Search para busca corporativa.


Vertex AI Vector Search para busca vetorial.


Prompt registry próprio em banco, com versionamento.


O ADK é o framework do Google para construir, depurar e implantar agentes de IA em escala empresarial. 
Documentos e OCR


Cloud Storage para repositório bruto.


Document AI para OCR, extração e parsing.


Cloud Run Jobs para processamento em lote.


Eventarc/Pub/Sub para acionar extração quando novo documento entra.


Dados


AlloyDB for PostgreSQL como banco principal.


pgvector para embeddings próximos do dado transacional.


BigQuery apenas para analytics, auditoria e BI, não para BigQuery ML.


Looker Studio/Looker para painéis de preços, produtividade e indicadores.


Dataplex/Data Catalog para governança, se o ambiente for maior.


Segurança


IAM por perfil.


Secret Manager para chaves.


Cloud KMS para criptografia.


VPC Service Controls, se houver dados sensíveis.


Cloud Audit Logs para trilha de auditoria.


Sensitive Data Protection / DLP para detectar dados pessoais.


Policy tags e classificação de documentos.


Logs de prompts e respostas, com hash e versionamento.


Exportação


DOCX;


PDF;


planilha de mapa de preços;


memória de cálculo;


quadro comparativo;


relatório de evidências;


checklist jurídico;


matriz de riscos.


6. Modelo de dados mínimo
Eu criaria este núcleo:
contratacao- id- órgão- unidade_demandante- objeto- modalidade- status- responsável- data_criação- versão_atualdocumento_gerado- id- contratacao_id- tipo: DFD, ETP, TR, mapa_preços, matriz_riscos- versão- conteúdo- status_aprovação- criado_por- criado_emfonte_normativa- id- tipo: lei, IN, guia, modelo, jurisprudência- nome- artigo- trecho- vigência- url- arquivofonte_mercado- id- tipo: PNCP, Compras.gov, ARP, contrato, cotação, fabricante- órgão- documento- url- data- confiabilidadeitem_mercado- id- fonte_mercado_id- descrição- descrição_normalizada- unidade- quantidade- valor- vigência- fabricante- sku- catmat_catser- score_comparabilidadedecisao- id- contratacao_id- tipo- justificativa- evidencias- aprovado_por- datarisco- id- contratacao_id- descrição- probabilidade- impacto- mitigação- responsávelprompt_execucao- id- agente- versão_prompt- entrada- saída- modelo- fontes_usadas- data
Esse desenho permite auditoria. Quando alguém perguntar “de onde veio esse preço?”, o sistema responde com fonte, item, cálculo e documento.
7. Fluxo operacional do produto
Etapa 1 — Entrada da demanda
Usuário responde perguntas guiadas:
Qual problema quer resolver?Qual área demandante?Existe PCA/PDTIC?Qual prazo?Há contrato atual?Há fornecedor atual?Há restrição técnica?Há dados pessoais?Há integração com sistemas internos?
O sistema gera:


diagnóstico da necessidade;


lacunas;


perguntas pendentes;


versão inicial do DFD/necessidade.


Etapa 2 — Pesquisa automática de mercado
Sistema executa:
buscar objetos similaresbuscar produtos equivalentesbuscar tecnologias substitutasbuscar riscos de direcionamentobuscar contratações de órgãos similares
Entrega:


alternativas;


matriz comparativa;


recomendação preliminar;


pontos que exigem validação humana.


Etapa 3 — Pesquisa de preços
Sistema executa:
PNCP → atas, contratos, editaisCompras.gov → itens homologadosPainel de Preços → referênciasPortais locais → complementaresFabricantes/distribuidores → cotações formais
Entrega:


mapa de preços;


fontes aceitas;


fontes descartadas;


preço médio, mediana, menor preço, referência recomendada;


normalização por mês, usuário, UST, item, contrato;


justificativa de comparabilidade.


Etapa 4 — Construção do ETP
O ETP sai com:


necessidade;


previsão no PCA;


requisitos;


estimativa de quantidades;


levantamento de mercado;


estimativa de valor;


descrição da solução;


justificativa da escolha;


resultados pretendidos;


providências prévias;


contratações correlatas;


sustentabilidade;


riscos;


conclusão de viabilidade.


Etapa 5 — Construção do TR
O TR sai com:


objeto;


condições gerais;


descrição da solução;


fundamentação da necessidade;


requisitos;


modelo de execução;


modelo de gestão;


critérios de medição e pagamento;


critérios de aceite;


obrigações da contratada;


obrigações da contratante;


SLA;


habilitação técnica;


estimativa de preço;


sanções;


proteção de dados;


anexos.


Etapa 6 — Revisão automática
Checklist:
ETP tem problema público claro?TR está coerente com ETP?Preço tem 3 fontes ou justificativa?Requisitos são suficientes, não excessivos?Há risco de marca sem justificativa?Critérios de aceite são mensuráveis?Há matriz de riscos?Há tratamento LGPD?Há memória de cálculo?Há evidência para cada afirmação relevante?
Etapa 7 — Aprovação humana
A IA sugere. A equipe aprova.
Papéis:
Demandante: valida necessidadeTIC: valida requisitos técnicosCompras: valida pesquisa de preçosJurídico: valida conformidadeAutoridade: aprova encaminhamento
8. Onde entra o RAG, sem depender 100% dele
Eu usaria quatro tipos de recuperação:
1. Busca lexical   Para termos exatos: CATMAT, CATSER, SKU, nome de órgão, número de ata.2. Busca semântica   Para achar similares: “IA corporativa”, “assistente generativo”, “plataforma de agentes”.3. Consulta SQL inteligente   Para preço, quantidade, vigência, média, mediana, órgão, modalidade.4. Grounding documental   Para citar trechos de lei, edital, ata, contrato ou proposta.
A resposta final do agente redator só pode usar o que veio do Evidence Bundle:
{  "afirmacao": "A solução X é tecnicamente adequada",  "evidencias": ["doc_123", "fonte_preco_45", "norma_18"],  "confianca": 0.87,  "pendencias": []}
Se não houver evidência, o texto entra como:
“Informação pendente de validação pela equipe técnica.”
9. Guardrails importantes
Eu colocaria regras duras:


Não gerar preço sem fonte.


Não gerar especificação que cite marca, salvo justificativa.


Não usar marketplace como fonte principal.


Não misturar licença com serviço técnico.


Não comparar contrato de 12 meses com 36 meses sem normalizar.


Não usar documento sem data ou sem origem.


Não concluir viabilidade sem matriz de alternativas.


Não gerar TR incoerente com ETP.


Não inventar item contratável.


Não ocultar baixa comparabilidade.


10. MVP que eu construiria primeiro
Eu faria em quatro sprints.
Sprint 1 — Base documental e geração assistida


upload de documentos;


extração com Document AI;


cadastro de contratação;


geração de ETP/TR a partir de template;


base normativa;


citações internas.


Sprint 2 — Pesquisa de preços


conector PNCP;


conector Compras.gov;


parsing de atas/contratos;


tabela de preços;


normalização básica;


mapa de preços.


Sprint 3 — Agentes especializados


agente de demanda;


agente de mercado;


agente de preço;


agente redator;


agente revisor;


trilha de auditoria.


Sprint 4 — Governança e produção


controle de versões;


aprovação por papéis;


exportação DOCX/PDF/XLSX;


logs;


dashboards;


segurança;


LGPD;


integração com SEI ou sistema interno.


11. Minha recomendação de arquitetura final
Eu iria nesta composição:
Frontend:Cloud Run + React/Next.jsAPIs:Cloud RunOrquestração:Workflows + Pub/Sub + Cloud TasksIA:Vertex AI GeminiGemini Enterprise Agent Platform / ADKAgent SearchVertex AI Vector SearchBanco:AlloyDB PostgreSQL com pgvectorBigQuery só para BI/auditoria, não como motor MLDocumentos:Cloud StorageDocument AISegurança:IAMIAPKMSSecret ManagerCloud Audit LogsDLPObservabilidade:Cloud LoggingCloud MonitoringError ReportingExportação:Serviço DOCX/PDFPlanilha de mapa de preçosRelatório de evidências
12. O diferencial do sistema
O diferencial não é “gerar texto bonito”. É gerar um processo defensável:
Demanda → Mercado → Preço → Solução → Risco → ETP → TR → Evidências → Aprovação
A plataforma precisa conseguir responder:
Por que essa solução?Por que esse preço?Por que essa quantidade?Por que esse requisito?Quais alternativas foram avaliadas?Quais fontes foram usadas?Quais fontes foram descartadas?Onde está a evidência?Quem aprovou?Qual versão do prompt/modelo gerou isso?
Essa é a diferença entre um RAG genérico e uma solução séria para ETP/TR.
