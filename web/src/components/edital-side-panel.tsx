'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

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

type ReprocStatus = 'idle' | 'starting' | 'running' | 'done' | 'err';

const REPROC_STEPS: { key: string; label: string; durationS: number }[] = [
  { key: 'cache',        label: 'Limpando cache de atestados',        durationS: 2 },
  { key: 'drive',        label: 'Recalculando somatório do Drive',     durationS: 8 },
  { key: 'matching',     label: 'Cruzando atestados × requisitos',     durationS: 12 },
  { key: 'juridico',     label: 'Reavaliando análise jurídica',        durationS: 15 },
  { key: 'persist',      label: 'Persistindo no Postgres',             durationS: 3 },
];
const TOTAL_S = REPROC_STEPS.reduce((a, s) => a + s.durationS, 0);

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
  onReprocessed,
}: { editalId: string; userEmail?: string; onReprocessed?: () => void }) {
  const [tab, setTab] = useState<'checklist' | 'comentarios'>('checklist');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [coments, setComents] = useState<Comentario[]>([]);
  const [newItem, setNewItem] = useState('');
  const [newComment, setNewComment] = useState('');
  const [reproc, setReproc] = useState<ReprocStatus>('idle');
  const [reprocMsg, setReprocMsg] = useState('');
  const [reprocAnalysisId, setReprocAnalysisId] = useState<string | null>(null);
  const [reprocStartedAt, setReprocStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Cleanup polling on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  // Tick elapsed time
  useEffect(() => {
    if (reproc !== 'starting' && reproc !== 'running') return;
    if (!reprocStartedAt) return;
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - reprocStartedAt) / 1000));
    }, 500);
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [reproc, reprocStartedAt]);

  // Poll juridico status while running
  useEffect(() => {
    if (reproc !== 'running' || !reprocAnalysisId) return;
    let cancel = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/proxy/editais/${reprocAnalysisId}/analise_juridica`, { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancel) return;
        if (data.status === 'done') {
          setReproc('done');
          setReprocMsg('Análise atualizada. Recarregando dados…');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          // Reload parent
          setTimeout(() => {
            onReprocessed?.();
            // Reset after a beat so user sees success state
            setTimeout(() => {
              setReproc('idle'); setReprocMsg(''); setReprocStartedAt(null); setElapsed(0); setReprocAnalysisId(null);
            }, 2500);
          }, 600);
        } else if (data.status === 'failed') {
          setReproc('err');
          setReprocMsg(data.error || 'Falha no reprocessamento');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch {}
    };
    pollRef.current = setInterval(poll, 2500);
    poll(); // immediate first hit
    return () => { cancel = true; if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [reproc, reprocAnalysisId, onReprocessed]);

  async function reprocess() {
    if (!confirm('Reprocessar análise jurídica? Útil quando há novo atestado ou informação relevante.')) return;
    setReproc('starting');
    setReprocMsg('');
    setReprocStartedAt(Date.now());
    setElapsed(0);
    try {
      const r = await fetch(`/api/proxy/editais/${editalId}/reprocess`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motivo: 'Solicitado pelo usuário' }),
      });
      if (!r.ok) {
        const txt = await r.text();
        setReproc('err'); setReprocMsg(txt.slice(0, 200) || `HTTP ${r.status}`);
        return;
      }
      const data = await r.json();
      setReprocAnalysisId(data.analysis_id);
      setReproc('running');
      setReprocMsg('');
    } catch (e: any) {
      setReproc('err'); setReprocMsg(e.message || 'Erro de rede');
    }
  }

  function dismissReproc() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = null;
    tickRef.current = null;
    setReproc('idle'); setReprocMsg(''); setReprocStartedAt(null); setElapsed(0); setReprocAnalysisId(null);
  }

  // Compute current step + progress
  const reprocActive = reproc === 'starting' || reproc === 'running';
  const progressPct = reprocActive
    ? Math.min(95, Math.round((elapsed / TOTAL_S) * 100))
    : reproc === 'done' ? 100 : 0;
  let currentStepIdx = 0;
  if (reprocActive) {
    let acc = 0;
    for (let i = 0; i < REPROC_STEPS.length; i++) {
      acc += REPROC_STEPS[i].durationS;
      if (elapsed < acc) { currentStepIdx = i; break; }
      currentStepIdx = i;
    }
  } else if (reproc === 'done') {
    currentStepIdx = REPROC_STEPS.length - 1;
  }

  const completed = items.filter((i) => i.checked).length;

  return (
    <aside
      className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden sticky top-4"
      style={{ maxHeight: 'calc(100vh - 96px)' }}
    >
      {/* Reprocess CTA on top */}
      <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white">
        {!reprocActive && reproc !== 'done' && reproc !== 'err' && (
          <button
            onClick={reprocess}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg,#047EA9,#00BEFF)',
              color: '#fff',
              boxShadow: '0 2px 10px rgba(4,126,169,0.25)',
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-3M20 14a8 8 0 01-14 3"/>
            </svg>
            Reprocessar análise
          </button>
        )}

        {reprocActive && (
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#00BEFF' }} />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: '#047EA9' }} />
                </span>
                <span className="text-sm font-bold text-slate-900 truncate">
                  {reproc === 'starting' ? 'Iniciando…' : 'Reprocessando'}
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
                {Math.floor(elapsed / 60).toString().padStart(2, '0')}:
                {(elapsed % 60).toString().padStart(2, '0')}
                <span className="text-slate-400"> / ~{Math.floor(TOTAL_S / 60)}:{(TOTAL_S % 60).toString().padStart(2, '0')}</span>
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden mb-2.5">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, #047EA9, #00BEFF, #C0FF7D)',
                  backgroundSize: '200% 100%',
                  animation: 'reprocShimmer 1.8s linear infinite',
                }}
              />
            </div>

            {/* Steps */}
            <ul className="space-y-1">
              {REPROC_STEPS.map((s, i) => {
                const isDone = i < currentStepIdx;
                const isActive = i === currentStepIdx;
                return (
                  <li key={s.key} className="flex items-center gap-2 text-[11px]">
                    <span
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: isDone ? '#16A34A' : isActive ? 'rgba(4,126,169,0.15)' : 'rgba(148,163,184,0.18)',
                        color: '#fff',
                      }}
                    >
                      {isDone ? (
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                        </svg>
                      ) : isActive ? (
                        <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="#047EA9" strokeWidth={3}>
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                          <path d="M22 12a10 10 0 00-10-10"/>
                        </svg>
                      ) : (
                        <span className="block w-1 h-1 rounded-full bg-slate-400"/>
                      )}
                    </span>
                    <span className={
                      isDone ? 'text-slate-400 line-through' :
                      isActive ? 'text-slate-900 font-semibold' :
                      'text-slate-500'
                    }>
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="mt-2 text-[10px] text-slate-400 italic">
              Pode continuar trabalhando — vamos avisar quando terminar.
            </p>
          </div>
        )}

        {reproc === 'done' && (
          <div className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'rgba(22,163,74,0.08)' }}>
            <svg className="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l3 3 5-6"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-emerald-800">Reprocessamento concluído</p>
              {reprocMsg && <p className="text-[11px] text-emerald-700 mt-0.5">{reprocMsg}</p>}
            </div>
          </div>
        )}

        {reproc === 'err' && (
          <div className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'rgba(225,72,73,0.08)' }}>
            <svg className="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="#E14849" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4M12 16h.01"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-red-700">Falha ao reprocessar</p>
              {reprocMsg && <p className="text-[11px] text-red-600 mt-0.5 break-words">{reprocMsg}</p>}
              <button onClick={dismissReproc} className="text-[11px] font-semibold text-red-700 hover:underline mt-1">
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        <style jsx>{`
          @keyframes reprocShimmer {
            0%   { background-position: 0% 0; }
            100% { background-position: 200% 0; }
          }
        `}</style>
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
