'use client';
import { useEffect, useState, useCallback } from 'react';

/* ══════════════════════════════════════════════════════════
   Selection dot — round, glassmorphism, branded
   ══════════════════════════════════════════════════════════ */
export function SelectDot({
  checked, onChange, ariaLabel = 'Selecionar', stopPropagation = true,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
  stopPropagation?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(ev) => { if (stopPropagation) { ev.stopPropagation(); ev.preventDefault(); } onChange(); }}
      className={`sel-dot ${checked ? 'sel-dot-on' : ''}`}
    >
      {checked && (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════
   Trash icon — small, refined
   ══════════════════════════════════════════════════════════ */
export function TrashIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════
   Confirm modal — glassmorphism, focus-trapped (basic)
   ══════════════════════════════════════════════════════════ */
export function ConfirmModal({
  open, title, message, confirmLabel = 'Apagar', cancelLabel = 'Cancelar',
  destructive = true, busy = false, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !busy) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${destructive ? 'bg-red-500/15' : 'bg-blue-500/15'}`}>
            {destructive
              ? <TrashIcon className="w-5 h-5 text-[#B91C1C]" />
              : <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-poppins font-bold text-base text-slate-900 mb-1">{title}</h3>
            <div className="text-sm text-slate-600 leading-relaxed">{message}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost text-sm">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`btn text-sm ${destructive ? 'btn-danger' : 'btn-primary'} disabled:opacity-60`}
          >
            {busy && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            )}
            {busy ? 'Apagando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Toast (auto-dismiss)
   ══════════════════════════════════════════════════════════ */
type Toast = { id: number; kind: 'success' | 'error'; text: string };
let _toastSeq = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = _toastSeq++;
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => remove(id), 3500);
  }, [remove]);
  return { toasts, push, remove };
}

export function ToastStack({ toasts, onClose }: { toasts: Toast[]; onClose: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'success' ? 'toast-success' : 'toast-error'}`}>
          {t.kind === 'success'
            ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          <span>{t.text}</span>
          <button onClick={() => onClose(t.id)} className="ml-2 opacity-50 hover:opacity-100 transition-opacity" aria-label="Fechar">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Bulk action bar (sticky) — with "More actions" menu
   ══════════════════════════════════════════════════════════ */
const STAGE_OPTIONS = [
  { key: 'identificacao', label: 'Identificação' },
  { key: 'analise',       label: 'Análise' },
  { key: 'pre_disputa',   label: 'Pré-disputa' },
  { key: 'proposta',      label: 'Proposta' },
  { key: 'disputa',       label: 'Disputa' },
  { key: 'habilitacao',   label: 'Habilitação' },
  { key: 'recursos',      label: 'Recursos' },
  { key: 'homologado',    label: 'Homologado' },
];

type BulkMenu = 'none' | 'vendedor' | 'prioridade' | 'fase';

export function BulkActionBar({
  count, onClear, onDelete, onBulkUpdate, busy,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onBulkUpdate?: (fields: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [menu, setMenu] = useState<BulkMenu>('none');
  const [vendedor, setVendedor] = useState('');
  const [prioridade, setPrioridade] = useState<string>('1');
  const [fase, setFase] = useState<string>('analise');
  const [applying, setApplying] = useState(false);

  // close menu when selection is cleared
  useEffect(() => { if (count === 0) setMenu('none'); }, [count]);

  if (count === 0) return null;

  async function applyBulk(fields: Record<string, unknown>) {
    if (!onBulkUpdate) return;
    setApplying(true);
    try { await onBulkUpdate(fields); setMenu('none'); }
    finally { setApplying(false); }
  }

  return (
    <>
      {/* Inline input panel above bar */}
      {menu !== 'none' && (
        <div className="fixed bottom-[72px] left-1/2 -translate-x-1/2 z-40 w-full max-w-sm px-4">
          <div className="card shadow-2xl space-y-3" style={{ borderColor: 'rgba(0,190,255,0.25)' }}>
            {menu === 'vendedor' && (
              <>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Atribuir vendedor</p>
                <input
                  type="email"
                  value={vendedor}
                  onChange={(e) => setVendedor(e.target.value)}
                  placeholder="vendedor@xertica.com"
                  className="input w-full text-sm"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') applyBulk({ vendedor_email: vendedor }); if (e.key === 'Escape') setMenu('none'); }}
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setMenu('none')} className="btn btn-ghost text-xs">Cancelar</button>
                  <button onClick={() => applyBulk({ vendedor_email: vendedor })} disabled={!vendedor || applying} className="btn btn-primary text-xs disabled:opacity-40">
                    {applying ? 'Aplicando…' : `Aplicar (${count})`}
                  </button>
                </div>
              </>
            )}
            {menu === 'prioridade' && (
              <>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Mudar prioridade</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPrioridade(String(p))}
                      className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-all ${prioridade === String(p) ? 'bg-pink-500/20 border border-pink-500/50 text-[#A85CA9]' : 'border border-slate-200 text-slate-500 hover:border-slate-300'}`}
                    >
                      P{p}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setMenu('none')} className="btn btn-ghost text-xs">Cancelar</button>
                  <button onClick={() => applyBulk({ prioridade: Number(prioridade) })} disabled={applying} className="btn btn-primary text-xs disabled:opacity-40">
                    {applying ? 'Aplicando…' : `Aplicar (${count})`}
                  </button>
                </div>
              </>
            )}
            {menu === 'fase' && (
              <>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Mover para fase</p>
                <select value={fase} onChange={(e) => setFase(e.target.value)} className="input w-full text-sm">
                  {STAGE_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setMenu('none')} className="btn btn-ghost text-xs">Cancelar</button>
                  <button onClick={() => applyBulk({ fase_atual: fase })} disabled={applying} className="btn btn-primary text-xs disabled:opacity-40">
                    {applying ? 'Aplicando…' : `Mover (${count})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="bulk-bar">
        <div className="flex items-center gap-3">
          <span className="bulk-bar-count">{count}</span>
          <span className="text-slate-900 font-medium">
            {count === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          <span className="hidden sm:inline text-xs text-slate-500 ml-2">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 border border-slate-200 text-[10px] font-mono">Esc</kbd> para limpar
          </span>
        </div>
        <div className="flex gap-2 items-center">
          {onBulkUpdate && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu(menu === 'none' ? 'vendedor' : 'none')}
                disabled={busy || applying}
                className="btn btn-ghost text-xs gap-1"
              >
                ⋯ Mais ações
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
              </button>
              {menu !== 'none' && (
                <div className="absolute bottom-full mb-2 right-0 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xl min-w-[160px] z-50">
                  {(['vendedor', 'prioridade', 'fase'] as BulkMenu[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMenu(m)}
                      className={`w-full text-left px-4 py-2.5 text-xs hover:bg-slate-100 transition-colors ${menu === m ? 'text-[#047EA9]' : 'text-slate-600'}`}
                    >
                      {m === 'vendedor'   && '👤 Atribuir vendedor'}
                      {m === 'prioridade' && '🔴 Mudar prioridade'}
                      {m === 'fase'       && '↗ Mover para fase'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={onClear} disabled={busy} className="btn btn-ghost text-xs">
            Limpar
          </button>
          <button onClick={onDelete} disabled={busy} className="btn btn-danger text-xs gap-1.5">
            <TrashIcon className="w-3.5 h-3.5" />
            {busy ? 'Apagando…' : `Apagar ${count}`}
          </button>
        </div>
      </div>
    </>
  );
}
