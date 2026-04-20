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
              ? <TrashIcon className="w-5 h-5 text-red-400" />
              : <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-poppins font-bold text-base text-white mb-1">{title}</h3>
            <div className="text-sm text-slate-400 leading-relaxed">{message}</div>
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
   Bulk action bar (sticky)
   ══════════════════════════════════════════════════════════ */
export function BulkActionBar({
  count, onClear, onDelete, busy,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="bulk-bar">
      <div className="flex items-center gap-3">
        <span className="bulk-bar-count">{count}</span>
        <span className="text-white font-medium">
          {count === 1 ? 'item selecionado' : 'itens selecionados'}
        </span>
        <span className="hidden sm:inline text-xs text-slate-500 ml-2">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-[10px] font-mono">Esc</kbd> para limpar
        </span>
      </div>
      <div className="flex gap-2">
        <button onClick={onClear} disabled={busy} className="btn btn-ghost text-xs">
          Limpar
        </button>
        <button onClick={onDelete} disabled={busy} className="btn btn-danger text-xs gap-1.5">
          <TrashIcon className="w-3.5 h-3.5" />
          {busy ? 'Apagando…' : `Apagar ${count}`}
        </button>
      </div>
    </div>
  );
}
