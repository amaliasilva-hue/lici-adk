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
// Tipos espelhando backend/models/copilot_schemas.py

export type ChecklistStatus =
  | "pendente"
  | "inferido"
  | "confirmado"
  | "dispensado"
  | "bloqueante";

export type ChecklistCriticidade = "baixa" | "media" | "alta" | "bloqueante";
export type ChecklistOwner = "orgao" | "sistema" | "ambos";
export type MensagemRole = "user" | "assistant" | "system";
export type FonteOrigem = "usuario" | "sistema" | "ia";

export interface ChecklistItem {
  item_key: string;
  categoria: string;
  rotulo: string;
  criticidade: ChecklistCriticidade;
  owner: ChecklistOwner;
  status: ChecklistStatus;
  valor?: string | number | boolean | null;
  fonte_id?: string | null;
  fonte_origem?: FonteOrigem | null;
  observacoes?: string | null;
  atualizado_em?: string | null;
}

export interface ChecklistSummary {
  total: number;
  por_status: Record<ChecklistStatus, number>;
  bloqueantes_pendentes: number;
}

export interface ChecklistResponse {
  contratacao_id: string;
  itens: ChecklistItem[];
  summary: ChecklistSummary;
}

export interface MensagemOut {
  id: string;
  role: MensagemRole;
  conteudo: string;
  created_at: string;
  intencao?: string | null;
  facts_added?: string[];
  decisions_added?: string[];
  checklist_updates?: string[];
}

export interface ChatHistoryResponse {
  conversa_id: string;
  resumo?: string | null;
  mensagens: MensagemOut[];
}

export interface SuggestedAction {
  tipo: string;
  rotulo: string;
  payload?: Record<string, unknown>;
}

// SSE events
export type StreamEvent =
  | { event: "assistant_token"; data: { delta: string } }
  | { event: "facts_added"; data: { facts: Array<{ tipo: string; valor: unknown }> } }
  | { event: "decisions_added"; data: { decisions: Array<{ tipo: string; valor: unknown }> } }
  | { event: "checklist_updated"; data: { items: string[] } }
  | { event: "price_sources_added"; data: { sources: Array<Record<string, unknown>> } }
  | { event: "suggested_actions"; data: { actions: SuggestedAction[] } }
  | { event: "turn_complete"; data: { mensagem_id: string; intencao?: string | null } }
  | { event: "error"; data: { message: string } };
