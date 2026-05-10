import type {
  Aprovacao,
  AprovacaoIn,
  ChatHistoryResponse,
  ChecklistItem,
  ChecklistPatch,
  ChecklistResponse,
  DocType,
  DocumentReadiness,
  DocumentoGeradoLite,
  EventoOut,
  FonteUsuario,
  FonteUsuarioIn,
  FonteUsuarioPatch,
  PesquisaNegativa,
  PesquisaNegativaIn,
  RevisorReport,
  StreamEvent,
} from "./types";
import { buildApiHeaders } from "@/lib/api";

const PROXY = "/api/proxy";

function buildUrl(contratacaoId: string, suffix: string): string {
  return `${PROXY}/proc/contratacoes/${contratacaoId}${suffix}`;
}

async function jsonOrThrow<T>(r: Response, label: string): Promise<T> {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${label} ${r.status}: ${text}`);
  }
  return r.json() as Promise<T>;
}

async function authFetch(path: string, init?: RequestInit & { contentType?: string | null }) {
  const headers = await buildApiHeaders(init?.headers, {
    contentType: init?.contentType ?? "application/json",
  });
  return fetch(path, {
    ...init,
    headers,
  });
}

// ── Checklist ──────────────────────────────────────────────────────────────
export async function getChecklist(contratacaoId: string): Promise<ChecklistResponse> {
  const r = await authFetch(buildUrl(contratacaoId, "/checklist"), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<ChecklistResponse>(r, "getChecklist");
}

export async function patchChecklist(
  contratacaoId: string,
  itemKey: string,
  patch: ChecklistPatch,
): Promise<ChecklistItem> {
  const r = await authFetch(
    buildUrl(contratacaoId, `/checklist/${encodeURIComponent(itemKey)}`),
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
  return jsonOrThrow<ChecklistItem>(r, "patchChecklist");
}

// ── Histórico ──────────────────────────────────────────────────────────────
export async function getHistory(
  contratacaoId: string,
  opts?: { limit?: number; before?: string },
): Promise<ChatHistoryResponse> {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.before) qs.set("before", opts.before);
  const suffix = `/chat/history${qs.toString() ? `?${qs}` : ""}`;
  const r = await authFetch(buildUrl(contratacaoId, suffix), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<ChatHistoryResponse>(r, "getHistory");
}

// ── Chat SSE ───────────────────────────────────────────────────────────────
export async function chatStream(
  contratacaoId: string,
  message: string,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await authFetch(buildUrl(contratacaoId, "/chat"), {
    method: "POST",
    headers: { accept: "text/event-stream" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`chatStream ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evt = parseSseChunk(raw);
      if (evt) onEvent(evt);
    }
  }
}

function parseSseChunk(chunk: string): StreamEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event) return null;
  const dataStr = dataLines.join("\n");
  let data: unknown = {};
  if (dataStr) {
    try { data = JSON.parse(dataStr); } catch { data = { raw: dataStr }; }
  }
  return { event, data } as StreamEvent;
}

// ── Sprint B: Fontes (Price Workbench) ─────────────────────────────────────
export async function listSources(contratacaoId: string): Promise<FonteUsuario[]> {
  const r = await authFetch(buildUrl(contratacaoId, "/fontes"), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<FonteUsuario[]>(r, "listSources");
}

export async function addSource(
  contratacaoId: string,
  payload: FonteUsuarioIn,
): Promise<FonteUsuario> {
  const r = await authFetch(buildUrl(contratacaoId, "/fontes"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<FonteUsuario>(r, "addSource");
}

export async function patchSource(
  contratacaoId: string,
  sourceId: string,
  payload: FonteUsuarioPatch,
): Promise<FonteUsuario> {
  const r = await authFetch(
    buildUrl(contratacaoId, `/fontes/${encodeURIComponent(sourceId)}`),
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return jsonOrThrow<FonteUsuario>(r, "patchSource");
}

export async function listNegativeSearches(
  contratacaoId: string,
): Promise<PesquisaNegativa[]> {
  const r = await authFetch(buildUrl(contratacaoId, "/pesquisas-negativas"), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<PesquisaNegativa[]>(r, "listNegativeSearches");
}

export async function addNegativeSearch(
  contratacaoId: string,
  payload: PesquisaNegativaIn,
): Promise<PesquisaNegativa> {
  const r = await authFetch(buildUrl(contratacaoId, "/pesquisas-negativas"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<PesquisaNegativa>(r, "addNegativeSearch");
}

// ── Sprint C: Readiness + geração ──────────────────────────────────────────
export async function getReadiness(
  contratacaoId: string,
  docType: DocType = "etp",
): Promise<DocumentReadiness> {
  const r = await authFetch(
    buildUrl(contratacaoId, `/readiness?doc_type=${docType}`),
    { cache: "no-store", contentType: null },
  );
  return jsonOrThrow<DocumentReadiness>(r, "getReadiness");
}

export async function gerarDocumento(
  contratacaoId: string,
  docType: DocType,
): Promise<DocumentoGeradoLite> {
  const r = await authFetch(buildUrl(contratacaoId, `/gerar/${docType}`), {
    method: "POST",
  });
  if (r.status === 422) {
    const body = await r.json().catch(() => ({}));
    const err = new Error("readiness_failed") as Error & {
      readiness?: DocumentReadiness;
    };
    err.readiness = body?.detail?.readiness as DocumentReadiness | undefined;
    throw err;
  }
  return jsonOrThrow<DocumentoGeradoLite>(r, "gerarDocumento");
}

export async function listDocumentos(
  contratacaoId: string,
): Promise<DocumentoGeradoLite[]> {
  const r = await authFetch(buildUrl(contratacaoId, "/documentos"), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<DocumentoGeradoLite[]>(r, "listDocumentos");
}

// ── Sprint D: Revisor + pacote ─────────────────────────────────────────────
export async function getRevisorReport(
  contratacaoId: string,
): Promise<RevisorReport> {
  const r = await authFetch(buildUrl(contratacaoId, "/revisar"), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<RevisorReport>(r, "getRevisorReport");
}

export function pacoteEvidenciasUrl(contratacaoId: string): string {
  return buildUrl(contratacaoId, "/pacote-evidencias");
}

// ── Sprint D extra: Aprovações + Eventos ─────────────────────────────────

export async function addAprovacao(
  contratacaoId: string, documentoId: string, payload: AprovacaoIn,
): Promise<Aprovacao> {
  const r = await authFetch(
    buildUrl(contratacaoId, `/documentos/${documentoId}/aprovacoes`),
    { method: "POST",
      body: JSON.stringify(payload) },
  );
  return jsonOrThrow<Aprovacao>(r, "addAprovacao");
}

export async function listAprovacoes(
  contratacaoId: string,
): Promise<Aprovacao[]> {
  const r = await authFetch(buildUrl(contratacaoId, "/aprovacoes"), {
    cache: "no-store",
    contentType: null,
  });
  return jsonOrThrow<Aprovacao[]>(r, "listAprovacoes");
}

export async function listEventos(
  contratacaoId: string, opts: { onlyUnread?: boolean; limit?: number } = {},
): Promise<EventoOut[]> {
  const qs = new URLSearchParams();
  if (opts.onlyUnread) qs.set("only_unread", "true");
  if (opts.limit) qs.set("limit", String(opts.limit));
  const r = await authFetch(
    buildUrl(contratacaoId, `/eventos${qs.size ? `?${qs}` : ""}`),
    { cache: "no-store", contentType: null },
  );
  return jsonOrThrow<EventoOut[]>(r, "listEventos");
}

export async function markEventosRead(
  contratacaoId: string,
): Promise<{ updated: number }> {
  const r = await authFetch(buildUrl(contratacaoId, "/eventos/marcar-lidos"), {
    method: "POST",
    contentType: null,
  });
  return jsonOrThrow<{ updated: number }>(r, "markEventosRead");
}
