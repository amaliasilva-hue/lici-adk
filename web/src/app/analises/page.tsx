'use client';
import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  SelectDot, TrashIcon, ConfirmModal, BulkActionBar, ToastStack, useToasts,
} from '@/components/bulk-actions';

type Row = {
  analysis_id: string;
  data_analise: string;
  orgao: string | null;
  uf: string | null;
  modalidade: string | null;
  status: string;
  score_aderencia: number | null;
  evidencias_count: number | null;
  pipeline_ms: number | null;
  edital_filename: string | null;
};

function badge(s: string) {
  if (s === 'APTO') return 'bg-green-100 text-green-800';
  if (s === 'APTO COM RESSALVAS') return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

export default function AnalisesPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm py-8 text-center">Carregando…</div>}>
      <AnalisesPageInner />
    </Suspense>
  );
}

function AnalisesPageInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toasts, push: toast, remove: closeToast } = useToasts();

  const orgao = sp.get('orgao') || '';
  const status = sp.get('status') || '';
  const uf = sp.get('uf') || '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (orgao) qs.set('orgao', orgao);
    if (status) qs.set('status', status);
    if (uf) qs.set('uf', uf);
    qs.set('limit', '50');
    try {
      const r = await fetch(`/api/proxy/analyses?${qs.toString()}`);
      if (!r.ok) throw new Error(`backend ${r.status}`);
      setRows(await r.json());
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [orgao, status, uf]);

  useEffect(() => { load(); }, [load]);

  // Esc clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirm && selected.size > 0) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, confirm]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.analysis_id));
    });
  }

  async function performDelete(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    setRemovingIds(new Set(ids));
    try {
      const r = await fetch('/api/proxy/analyses/bulk_delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error(`falha ${r.status}`);
      const out = await r.json().catch(() => ({}));
      const deleted: number = typeof out.deleted === 'number' ? out.deleted : ids.length;
      const failed = ids.length - deleted;
      await new Promise((res) => setTimeout(res, 220));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await load();
      if (failed > 0) toast('error', `${deleted} apagado(s), ${failed} falhou(aram)`);
      else toast('success', deleted === 1 ? 'Análise apagada' : `${deleted} análises apagadas`);
    } catch (e: any) {
      toast('error', `Falha ao apagar: ${e.message || e}`);
    } finally {
      setRemovingIds(new Set());
      setDeleting(false);
      setConfirm(null);
    }
  }

  function askDeleteOne(row: Row) {
    setConfirm({
      ids: [row.analysis_id],
      label: row.orgao || row.edital_filename || row.analysis_id,
    });
  }

  function askDeleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setConfirm({ ids, label: `${ids.length} análises` });
  }

  const allSelected = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows.length, selected.size]);
  const someSelected = selected.size > 0 && !allSelected;
  const hasSelection = selected.size > 0;

  return (
    <div className={`space-y-5 animate-fade-in ${hasSelection ? 'has-selection' : ''}`}>
      <div className="card">
        <h1 className="text-xl font-bold mb-3">Histórico de análises</h1>
        <form
          className="flex flex-wrap gap-2 text-sm"
          onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            const qs = new URLSearchParams();
            for (const [k, v] of fd.entries()) {
              const s = String(v).trim();
              if (s) qs.set(k, s);
            }
            router.push(`/analises?${qs.toString()}`);
          }}
        >
          <input name="orgao" defaultValue={orgao} placeholder="Órgão" className="input w-48" />
          <select name="status" defaultValue={status} className="input w-44">
            <option value="">Status…</option>
            <option>APTO</option>
            <option>APTO COM RESSALVAS</option>
            <option>INAPTO</option>
            <option>NO-GO</option>
          </select>
          <input name="uf" defaultValue={uf} placeholder="UF" maxLength={2} className="input w-20 uppercase" />
          <button className="btn btn-primary text-sm">Filtrar</button>
        </form>
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        count={selected.size}
        busy={deleting}
        onClear={() => setSelected(new Set())}
        onDelete={askDeleteSelected}
      />

      {error && <div className="alert-danger">Erro: {error}</div>}

      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-2 w-8">
                {rows.length > 0 && (
                  <SelectDot
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    ariaLabel={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                  />
                )}
              </th>
              <th className="py-2 pr-3">Data</th>
              <th className="py-2 pr-3">Órgão</th>
              <th className="py-2 pr-3">UF</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Score</th>
              <th className="py-2 pr-3 text-right">Evid.</th>
              <th className="py-2 pr-3 text-right">Tempo</th>
              <th className="py-2 pr-2"></th>
              <th className="py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="py-6 text-center text-slate-400">Carregando…</td></tr>
            )}
            {!loading && rows.map((r) => {
              const isSelected = selected.has(r.analysis_id);
              const isRemoving = removingIds.has(r.analysis_id);
              return (
                <tr
                  key={r.analysis_id}
                  className={`group border-b border-slate-100 last:border-0 transition-all ${isSelected ? 'is-selected bg-white/[0.03]' : 'hover:bg-slate-50'} ${isRemoving ? 'opacity-30' : ''}`}
                >
                  <td className="py-2 pr-2">
                    <SelectDot checked={isSelected} onChange={() => toggleSelected(r.analysis_id)} />
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{new Date(r.data_analise).toLocaleString('pt-BR')}</td>
                  <td className="py-2 pr-3">{r.orgao || '—'}</td>
                  <td className="py-2 pr-3">{r.uf || '—'}</td>
                  <td className="py-2 pr-3"><span className={`badge ${badge(r.status)}`}>{r.status}</span></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.score_aderencia ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.evidencias_count ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.pipeline_ms ? `${Math.round(r.pipeline_ms / 1000)}s` : '—'}</td>
                  <td className="py-2 pr-2">
                    <Link href={`/analises/${r.analysis_id}`} className="text-xertica-600 hover:underline">abrir →</Link>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => askDeleteOne(r)}
                      disabled={deleting}
                      title="Apagar análise"
                      aria-label="Apagar análise"
                      className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && !error && (
              <tr><td colSpan={10} className="py-6 text-center text-slate-400">Nenhuma análise encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!confirm}
        busy={deleting}
        title={confirm && confirm.ids.length > 1 ? `Apagar ${confirm.ids.length} análises?` : 'Apagar análise?'}
        message={
          confirm && confirm.ids.length > 1 ? (
            <>
              Esta ação removerá <strong className="text-white">{confirm.ids.length}</strong> análises do histórico.
              <br />Não poderá ser desfeita.
            </>
          ) : (
            <>
              Esta ação removerá <strong className="text-white">{confirm?.label}</strong> do histórico.
              <br />Não poderá ser desfeita.
            </>
          )
        }
        confirmLabel={confirm && confirm.ids.length > 1 ? `Apagar ${confirm.ids.length}` : 'Apagar'}
        onCancel={() => !deleting && setConfirm(null)}
        onConfirm={() => confirm && performDelete(confirm.ids)}
      />

      {/* unused vars suppression for layout consistency */}
      <span className="sr-only">{someSelected ? 'parcial' : ''}</span>

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}
