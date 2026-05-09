'use client';
import { useEffect, useState, useCallback } from 'react';

type ChecklistItem = {
  item_id: string;
  label: string;
  checked: boolean;
  order_idx: number;
  autor_email?: string;
  criado_em?: string;
};

type Comentario = {
  comentario_id: string;
  autor_email: string;
  texto: string;
  secao?: string | null;
  criado_em?: string;
};

function fmtAgo(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function EditalSidePanel({
  editalId,
  userEmail = 'usuario@xertica.com',
}: { editalId: string; userEmail?: string }) {
  const [tab, setTab] = useState<'checklist' | 'comentarios'>('checklist');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [coments, setComents] = useState<Comentario[]>([]);
  const [newItem, setNewItem] = useState('');
  const [newComment, setNewComment] = useState('');
  const [reproc, setReproc] = useState<'idle' | 'running' | 'ok' | 'err'>('idle');
  const [reprocMsg, setReprocMsg] = useState('');

  const loadChecklist = useCallback(async () => {
    try {
      const r = await fetch(`/api/proxy/editais/${editalId}/checklist`, { cache: 'no-store' });
      if (r.ok) setItems(await r.json());
    } catch {}
  }, [editalId]);

  const loadComents = useCallback(async () => {
    try {
      const r = await fetch(`/api/proxy/editais/${editalId}/comentarios`, { cache: 'no-store' });
      if (r.ok) setComents(await r.json());
    } catch {}
  }, [editalId]);

  useEffect(() => { loadChecklist(); loadComents(); }, [loadChecklist, loadComents]);

  async function addItem() {
    const label = newItem.trim();
    if (!label) return;
    setNewItem('');
    await fetch(`/api/proxy/editais/${editalId}/checklist`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, autor_email: userEmail }),
    });
    await loadChecklist();
  }

  async function toggleItem(it: ChecklistItem) {
    setItems((prev) => prev.map((x) => x.item_id === it.item_id ? { ...x, checked: !x.checked } : x));
    await fetch(`/api/proxy/editais/${editalId}/checklist/${it.item_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checked: !it.checked }),
    });
  }

  async function deleteItem(it: ChecklistItem) {
    setItems((prev) => prev.filter((x) => x.item_id !== it.item_id));
    await fetch(`/api/proxy/editais/${editalId}/checklist/${it.item_id}`, { method: 'DELETE' });
  }

  async function addComment() {
    const texto = newComment.trim();
    if (!texto) return;
    setNewComment('');
    await fetch(`/api/proxy/editais/${editalId}/comentarios`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto, autor_email: userEmail, secao: 'sidebar' }),
    });
    await loadComents();
  }

  async function deleteComment(c: Comentario) {
    setComents((prev) => prev.filter((x) => x.comentario_id !== c.comentario_id));
    await fetch(`/api/proxy/editais/${editalId}/comentarios/${c.comentario_id}`, { method: 'DELETE' });
  }

  async function reprocess() {
    if (!confirm('Reprocessar análise jurídica? Útil quando há novo atestado ou informação relevante.')) return;
    setReproc('running');
    setReprocMsg('');
    try {
      const r = await fetch(`/api/proxy/editais/${editalId}/reprocess`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motivo: 'Solicitado pelo usuário' }),
      });
      if (!r.ok) {
        const txt = await r.text();
        setReproc('err'); setReprocMsg(txt.slice(0, 200));
        return;
      }
      setReproc('ok'); setReprocMsg('Reprocessamento iniciado. Atualize a página em ~30s.');
    } catch (e: any) {
      setReproc('err'); setReprocMsg(e.message || 'Erro');
    }
  }

  const completed = items.filter((i) => i.checked).length;

  return (
    <aside
      className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden sticky top-4"
      style={{ maxHeight: 'calc(100vh - 96px)' }}
    >
      {/* Reprocess CTA on top */}
      <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white">
        <button
          onClick={reprocess}
          disabled={reproc === 'running'}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{
            background: reproc === 'running' ? '#94A3B8' : 'linear-gradient(135deg,#047EA9,#00BEFF)',
            color: '#fff',
            boxShadow: '0 2px 10px rgba(4,126,169,0.25)',
          }}
        >
          {reproc === 'running' ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                <path d="M22 12a10 10 0 00-10-10"/>
              </svg>
              Reprocessando…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-3M20 14a8 8 0 01-14 3"/>
              </svg>
              Reprocessar análise
            </>
          )}
        </button>
        {reprocMsg && (
          <p className={`mt-2 text-[11px] ${reproc === 'err' ? 'text-red-600' : 'text-slate-600'}`}>
            {reprocMsg}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 shrink-0">
        <button
          onClick={() => setTab('checklist')}
          className={`flex-1 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === 'checklist'
            ? 'text-slate-900 border-b-2 border-[#047EA9] bg-slate-50'
            : 'text-slate-500 hover:text-slate-800'}`}
        >
          Checklist {items.length > 0 && (
            <span className="ml-1 text-[10px] text-slate-500">({completed}/{items.length})</span>
          )}
        </button>
        <button
          onClick={() => setTab('comentarios')}
          className={`flex-1 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === 'comentarios'
            ? 'text-slate-900 border-b-2 border-[#047EA9] bg-slate-50'
            : 'text-slate-500 hover:text-slate-800'}`}
        >
          Notas {coments.length > 0 && (
            <span className="ml-1 text-[10px] text-slate-500">({coments.length})</span>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {tab === 'checklist' && (
          <div className="px-3 py-3">
            <ul className="space-y-1.5 mb-2">
              {items.length === 0 && (
                <li className="text-xs text-slate-400 italic px-2 py-2">
                  Sem itens. Adicione tarefas, pendências e validações abaixo.
                </li>
              )}
              {items.map((it) => (
                <li key={it.item_id} className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={it.checked}
                    onChange={() => toggleItem(it)}
                    className="mt-0.5 w-4 h-4 rounded accent-[#047EA9] cursor-pointer"
                  />
                  <span className={`flex-1 text-sm ${it.checked ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    {it.label}
                  </span>
                  <button
                    onClick={() => deleteItem(it)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all text-xs"
                    title="Remover"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); addItem(); }} className="flex gap-1.5 mt-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Nova tarefa…"
                className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-md focus:border-[#047EA9] focus:outline-none focus:ring-2 focus:ring-[#047EA9]/15"
              />
              <button
                type="submit"
                disabled={!newItem.trim()}
                className="px-2.5 py-1.5 rounded-md bg-[#047EA9] text-white text-sm font-semibold disabled:opacity-40 hover:bg-[#036086] transition-colors"
              >
                +
              </button>
            </form>
          </div>
        )}

        {tab === 'comentarios' && (
          <div className="px-3 py-3">
            <ul className="space-y-2 mb-3">
              {coments.length === 0 && (
                <li className="text-xs text-slate-400 italic px-1 py-2">
                  Sem notas. Use este espaço para anotações da equipe, dúvidas e esclarecimentos pendentes.
                </li>
              )}
              {coments.map((c) => (
                <li key={c.comentario_id} className="group bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-slate-700 truncate">
                      {c.autor_email.split('@')[0]}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400">{fmtAgo(c.criado_em)}</span>
                      <button
                        onClick={() => deleteComment(c)}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all text-[11px]"
                        title="Remover"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{c.texto}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); addComment(); }}>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Anote dúvida, esclarecimento ou observação…"
                rows={3}
                className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-md focus:border-[#047EA9] focus:outline-none focus:ring-2 focus:ring-[#047EA9]/15 resize-none"
              />
              <button
                type="submit"
                disabled={!newComment.trim()}
                className="mt-1.5 w-full px-3 py-1.5 rounded-md bg-[#047EA9] text-white text-sm font-semibold disabled:opacity-40 hover:bg-[#036086] transition-colors"
              >
                Postar nota
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
