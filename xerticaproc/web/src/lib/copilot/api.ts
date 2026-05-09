import type {
  ChatHistoryResponse,
  ChecklistItem,
  ChecklistPatch,
  ChecklistResponse,
  FonteUsuario,
  FonteUsuarioIn,
  FonteUsuarioPatch,
  PesquisaNegativa,
  PesquisaNegativaIn,
  StreamEvent,
} from "./types";

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

// ── Checklist ──────────────────────────────────────────────────────────────
export async function getChecklist(contratacaoId: string): Promise<ChecklistResponse> {
  const r = await fetch(buildUrl(contratacaoId, "/checklist"), { cache: "no-store" });
  return jsonOrThrow<ChecklistResponse>(r, "getChecklist");
}

export async function patchChecklist(
  contratacaoId: string,
  itemKey: string,
  patch: ChecklistPatch,
): Promise<ChecklistItem> {
  const r = await fetch(
    buildUrl(contratacaoId, `/checklist/${encodeURIComponent(itemKey)}`),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
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
  const r = await fetch(buildUrl(contratacaoId, suffix), { cache: "no-store" });
  return jsonOrThrow<ChatHistoryResponse>(r, "getHistory");
}

// ── Chat SSE ───────────────────────────────────────────────────────────────
export async function chatStream(
  contratacaoId: string,
  message: string,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(buildUrl(contratacaoId, "/chat"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
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
  const r = await fetch(buildUrl(contratacaoId, "/fontes"), { cache: "no-store" });
  return jsonOrThrow<FonteUsuario[]>(r, "listSources");
}

export async function addSource(
  contratacaoId: string,
  payload: FonteUsuarioIn,
): Promise<FonteUsuario> {
  const r = await fetch(buildUrl(contratacaoId, "/fontes"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<FonteUsuario>(r, "addSource");
}

export async function patchSource(
  contratacaoId: string,
  sourceId: string,
  payload: FonteUsuarioPatch,
): Promise<FonteUsuario> {
  const r = await fetch(
    buildUrl(contratacaoId, `/fontes/${encodeURIComponent(sourceId)}`),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return jsonOrThrow<FonteUsuario>(r, "patchSource");
}

export async function listNegativeSearches(
  contratacaoId: string,
): Promise<PesquisaNegativa[]> {
  const r = await fetch(buildUrl(contratacaoId, "/pesquisas-negativas"), {
    cache: "no-store",
  });
  return jsonOrThrow<PesquisaNegativa[]>(r, "listNegativeSearches");
}

export async function addNegativeSearch(
  contratacaoId: string,
  payload: PesquisaNegativaIn,
): Promise<PesquisaNegativa> {
  const r = await fetch(buildUrl(contratacaoId, "/pesquisas-negativas"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<PesquisaNegativa>(r, "addNegativeSearch");
}
import type {
  ChatHistoryResponse,
  ChecklistItem,
  ChecklistResponse,
  StreamEvent,
} from "./types";

const PROXY = "/api/proxy";

function buildUrl(contratacaoId: string, suffix: string): string {
  return `${PROXY}/proc/contratacoes/${contratacaoId}${suffix}`;
}

export async function getChecklist(
  contratacaoId: string,
): Promise<ChecklistResponse> {
  const r = await fetch(buildUrl(contratacaoId, "/checklist"), {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`getChecklist ${r.status}`);
  return r.json();
}

export async function patchChecklist(
  contratacaoId: string,
  itemKey: string,
  patch: Partial<ChecklistItem> & { justificativa?: string },
): Promise<ChecklistItem> {
  const r = await fetch(
    buildUrl(contratacaoId, `/checklist/${encodeURIComponent(itemKey)}`),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`patchChecklist ${r.status}: ${text}`);
  }
  return r.json();
}

export async function getHistory(
  contratacaoId: string,
  opts?: { limit?: number; before?: string },
): Promise<ChatHistoryResponse> {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.before) qs.set("before", opts.before);
  const suffix = `/chat/history${qs.toString() ? `?${qs}` : ""}`;
  const r = await fetch(buildUrl(contratacaoId, suffix), { cache: "no-store" });
  if (!r.ok) throw new Error(`getHistory ${r.status}`);
  return r.json();
}

/**
 * Faz POST /chat e consome SSE até `turn_complete` ou `error`.
 * Chama onEvent para cada evento parseado.
 */
export async function chatStream(
  contratacaoId: string,
  message: string,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(buildUrl(contratacaoId, "/chat"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({ conteudo: message }),
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
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = { raw: dataStr };
    }
  }
  return { event, data } as StreamEvent;
}
