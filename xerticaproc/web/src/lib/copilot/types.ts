// Tipos alinhados com backend/models/copilot_schemas.py

export type ChecklistStatus =
  | "pendente"
  | "inferido"
  | "confirmado"
  | "dispensado";

export type ChecklistCriticidade = "bloqueante" | "alto" | "medio" | "baixo";
export type ChecklistOwner = "usuario" | "orgao" | "sistema" | "juridico";
export type MensagemRole = "user" | "assistant" | "system";
export type FonteOrigem = "usuario" | "sistema" | "documento" | "pesquisa";

export type ClassificacaoPreco =
  | "direta"
  | "indireta"
  | "parametrica"
  | "complementar"
  | "outlier"
  | "descartada";

export type FonteUsuarioStatus = "pendente" | "validada" | "descartada";

export interface ChecklistItem {
  item_key: string;
  categoria: string;
  label: string;
  status: ChecklistStatus;
  criticidade: ChecklistCriticidade;
  owner: ChecklistOwner;
  valor?: unknown;
  evidence_ids?: string[];
  justificativa?: string | null;
  atualizado_em?: string | null;
}

export interface ChecklistSummary {
  total: number;
  confirmado: number;
  inferido: number;
  pendente: number;
  dispensado: number;
  bloqueante_pendente: number;
}

export interface ChecklistResponse {
  by_category: Record<string, ChecklistItem[]>;
  summary: ChecklistSummary;
}

export interface ChecklistPatch {
  status: ChecklistStatus;
  valor?: unknown;
  justificativa?: string;
}

export interface Anexo {
  tipo: "url" | "arquivo" | "imagem" | "texto";
  nome: string;
  gcs_uri?: string | null;
  url?: string | null;
}

export interface MensagemOut {
  id: string;
  role: MensagemRole;
  conteudo: string;
  meta?: Record<string, unknown>;
  anexos?: Anexo[];
  criado_em: string;
}

export interface ChatHistoryResponse {
  messages: MensagemOut[];
  has_more: boolean;
}

export interface MensagemIn {
  message: string;
  anexos?: Anexo[];
}

export interface SuggestedAction {
  label: string;
  command: string;
}

// SSE — eventos emitidos por backend.stream_turn
export type StreamEvent =
  | { event: "assistant_token"; data: { text: string } }
  | { event: "facts_added"; data: { facts: Array<{ tipo: string; valor: unknown }> } }
  | { event: "decisions_added"; data: { decisions: Array<{ tipo: string; valor: unknown }> } }
  | { event: "checklist_updated"; data: { keys: string[]; updates?: unknown[] } }
  | { event: "price_sources_added"; data: { sources: Array<Record<string, unknown>> } }
  | {
      event: "turn_complete";
      data: {
        message_id: string;
        intent: string;
        next_best_question?: string | null;
        suggested_actions?: SuggestedAction[];
      };
    }
  | { event: "error"; data: { code?: string; message: string } };

// Sprint B — Price Workbench
export interface FonteUsuarioIn {
  tipo: "url" | "texto_colado" | "arquivo" | "print";
  url?: string;
  texto_colado?: string;
  arquivo_gcs_uri?: string;
  produto?: string;
  observacao?: string;
}

export interface FonteUsuario {
  id: string;
  contratacao_id: string;
  tipo: "url" | "texto_colado" | "arquivo" | "print";
  status: FonteUsuarioStatus;
  url?: string | null;
  texto_colado?: string | null;
  arquivo_gcs_uri?: string | null;
  produto?: string | null;
  valor_total?: number | null;
  quantidade?: number | null;
  vigencia_meses?: number | null;
  valor_mensal_unitario?: number | null;
  classificacao?: ClassificacaoPreco | null;
  score?: number | null;
  observacao?: string | null;
  criado_em: string;
  validado_em?: string | null;
}

export interface FonteUsuarioPatch {
  classificacao?: ClassificacaoPreco;
  status?: FonteUsuarioStatus;
  observacao?: string;
}

export interface PesquisaNegativaIn {
  termo: string;
  fontes_consultadas: string[];
  justificativa?: string;
  efeito_na_estimativa?: string;
}

export interface PesquisaNegativa extends PesquisaNegativaIn {
  id: string;
  contratacao_id: string;
  criado_em: string;
}

// Sprint C — Readiness + Documentos gerados

export interface MissingItem {
  item_key: string;
  label: string;
  criticidade: ChecklistCriticidade;
  owner: ChecklistOwner;
}

export type DocType = "etp" | "tr" | "mapa_precos";

export interface DocumentReadiness {
  doc_type: DocType;
  can_generate: boolean;
  score: number;
  blocking_missing: MissingItem[];
  optional_missing: MissingItem[];
  inferred_items: MissingItem[];
  open_fields_for_orgao: MissingItem[];
  recommendations?: string | null;
  avaliado_em: string;
}

export interface DocumentoGeradoLite {
  id: string;
  contratacao_id: string;
  doc_type: DocType;
  versao: number;
  content_md: string;
  readiness_snapshot: DocumentReadiness;
  gerado_em: string;
}

// Sprint D — Revisor

export type FindingSeverity = "info" | "warn" | "error";

export interface RevisorFinding {
  code: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  refs?: string[];
}

export interface RevisorReport {
  contratacao_id: string;
  avaliado_em: string;
  findings: RevisorFinding[];
  summary: { info: number; warn: number; error: number };
}

// ── Sprint D extra: Aprovações + Eventos ─────────────────────────────────
export type AprovacaoDecisao = "aprovado" | "rejeitado" | "retorno";

export interface AprovacaoIn {
  aprovado_por: string;
  papel: string;
  decisao: AprovacaoDecisao;
  comentario?: string | null;
}

export interface Aprovacao extends AprovacaoIn {
  id: string;
  contratacao_id: string;
  documento_id: string;
  criado_em: string;
}

export interface EventoOut {
  id: string;
  contratacao_id: string;
  tipo: string;
  payload: Record<string, unknown>;
  lido: boolean;
  criado_em: string;
}

// ── Biblioteca de Documentos ────────────────────────────────────────────────
export type DocumentoOrigem =
  | "upload_chat"
  | "gerado"
  | "fonte_externa"
  | "drive_sync"
  | "pesquisa_negativa";

export type DocumentoStatus =
  | "processando"
  | "pronto"
  | "falhou"
  | "arquivado";

export interface Documento {
  id: string;
  contratacao_id: string;
  nome: string;
  mime: string;
  bytes_size: number;
  pages?: number | null;
  sha256: string;
  origem: DocumentoOrigem;
  origem_ref: Record<string, unknown>;
  storage_uri: string;
  thumb_uri?: string | null;
  preview_uri?: string | null;
  text_excerpt?: string | null;
  status: DocumentoStatus;
  meta: Record<string, unknown>;
  uploaded_by?: string | null;
  criado_em: string;
  processado_em?: string | null;
}

export interface DocumentoListResponse {
  items: Documento[];
  total: number;
}
