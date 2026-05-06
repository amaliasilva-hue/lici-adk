/**
 * xerticaproc — typed API client
 * Wraps all calls to the FastAPI backend.
 * Uses the Next.js API route proxy (/api/proxy/[...path]) to inject the
 * Google ID-token automatically (via the server-side session).
 */

export const API_BASE =
  typeof window === "undefined"
    ? (process.env.BACKEND_URL ?? "http://localhost:8000")
    : "/api/proxy";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StatusContratacao =
  | "rascunho"
  | "em_analise"
  | "pesquisa_mercado"
  | "pesquisa_precos"
  | "revisao"
  | "aprovado"
  | "cancelado";

export type TipoDocumento = "ETP" | "TR" | "DFD" | "PCA";

export interface EntradaDemanda {
  id_orgao: string;
  nome_orgao: string;
  uasg?: string;
  objeto_resumido: string;
  descricao_necessidade: string;
  valor_estimado_maximo?: number;
  prazo_vigencia_meses?: number;
  natureza_objeto?: "servico" | "bem" | "obra" | "solucao_ti";
  palavras_chave: string[];
  data_necessidade?: string; // ISO date
  dfd_texto?: string;
}

export interface ContratacaoSummary {
  id: string;
  status: StatusContratacao;
  objeto_resumido: string;
  nome_orgao: string;
  criado_em: string;
  atualizado_em: string;
}

export interface JobStatus {
  job_id: string;
  status: "pending" | "running" | "done" | "failed";
  etapa?: string;
  progresso?: number;
  erro?: string;
  resultado?: unknown;
}

export interface ItemPreco {
  fonte: string;
  tipo_fonte: string;
  descricao_licitada: string;
  valor_unitario: number;
  unidade: string;
  quantidade?: number;
  vigencia_meses?: number;
  data_referencia?: string;
  orgao_comprador?: string;
  numero_processo?: string;
  url_evidencia?: string;
  score_comparabilidade: number;
  flags_qualidade: string[];
}

export interface MapaPrecos {
  id_contratacao: string;
  objeto_ref: string;
  unidade_ref: string;
  vigencia_ref_meses?: number;
  total_fontes_consultadas: number;
  total_itens_coletados: number;
  total_itens_validos: number;
  itens_validos: ItemPreco[];
  preco_mediana?: number;
  preco_media?: number;
  preco_p25?: number;
  preco_p75?: number;
  preco_minimo?: number;
  preco_maximo?: number;
  desvio_padrao?: number;
  coeficiente_variacao?: number;
  preco_referencia?: number;
  justificativa_metodologia?: string;
  gerado_em: string;
}

export interface DocumentoGerado {
  id_contratacao: string;
  tipo_documento: TipoDocumento;
  conteudo_markdown: string;
  versao: number;
  gerado_em: string;
  pendencias: string[];
  tokens_usados?: number;
}

export interface RelatorioRevisao {
  id_contratacao: string;
  tipo_documento: TipoDocumento;
  aprovado: boolean;
  score_qualidade: number;
  conformidade_lei_14133: boolean;
  conformidade_in_94: boolean;
  issues: {
    secao: string;
    tipo: "erro" | "aviso" | "sugestao";
    descricao: string;
    clausula_legal?: string;
  }[];
  sugestoes_melhoria: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Contratações ────────────────────────────────────────────────────────────

export const api = {
  contratacoes: {
    list(): Promise<ContratacaoSummary[]> {
      return apiFetch("/proc/contratacoes");
    },
    get(id: string): Promise<ContratacaoSummary> {
      return apiFetch(`/proc/contratacoes/${id}`);
    },
    create(body: EntradaDemanda): Promise<{ id: string; status: string }> {
      return apiFetch("/proc/contratacoes", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    runPipeline(id: string): Promise<{ job_id: string }> {
      return apiFetch(`/proc/contratacoes/${id}/pipeline`, {
        method: "POST",
      });
    },
    runEtapa(id: string, etapa: string): Promise<{ job_id: string }> {
      return apiFetch(`/proc/contratacoes/${id}/etapa/${etapa}`, {
        method: "POST",
      });
    },
    getMapaPrecos(id: string): Promise<MapaPrecos> {
      return apiFetch(`/proc/contratacoes/${id}/mapa-precos`);
    },
    getEtp(id: string): Promise<DocumentoGerado> {
      return apiFetch(`/proc/contratacoes/${id}/etp`);
    },
    getTr(id: string): Promise<DocumentoGerado> {
      return apiFetch(`/proc/contratacoes/${id}/tr`);
    },
    getBundle(id: string): Promise<unknown> {
      return apiFetch(`/proc/contratacoes/${id}/bundle`);
    },
  },

  jobs: {
    get(jobId: string): Promise<JobStatus> {
      return apiFetch(`/proc/jobs/${jobId}`);
    },
  },

  health: {
    check(): Promise<{ status: string }> {
      return apiFetch("/proc/healthz");
    },
  },
};

// ─── Polling helper ──────────────────────────────────────────────────────────

export async function pollJob(
  jobId: string,
  onProgress?: (job: JobStatus) => void,
  intervalMs = 3000,
  timeoutMs = 600_000
): Promise<JobStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await api.jobs.get(jobId);
    onProgress?.(job);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Job ${jobId} timed out after ${timeoutMs / 1000}s`);
}
