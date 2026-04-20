'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  SelectDot, TrashIcon, ConfirmModal, BulkActionBar, ToastStack, useToasts,
} from '@/components/bulk-actions';

const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'identificacao', label: 'Identificação', color: '#94A3B8' },
  { key: 'analise',       label: 'Análise',       color: '#00BEFF' },
  { key: 'pre_disputa',   label: 'Pré-disputa',   color: '#FF89FF' },
  { key: 'proposta',      label: 'Proposta',       color: '#047EA9' },
  { key: 'disputa',       label: 'Disputa',        color: '#F59E0B' },
  { key: 'habilitacao',   label: 'Habilitação',    color: '#A85CA9' },
  { key: 'recursos',      label: 'Recursos',       color: '#E14849' },
  { key: 'homologado',    label: 'Homologado',     color: '#C0FF7D' },
];

const TERMINAL_COLORS: Record<string, string> = {
  ganho:               'badge-green',
  perdido:             'badge-red',
  inabilitado:         'badge-red',
  revogado:            'badge-gray',
  nao_participamos:    'badge-gray',
};

type Edital = {
  edital_id: string;
  orgao: string;
  uf: string;
  objeto?: string;
  fase_atual: string;
  estado_terminal?: string;
  score_comercial?: number;
  prioridade?: number;
  numero_pregao?: string;
  vendedor_email?: string;
  criado_em?: string;
};

function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const cls = score >= 70 ? 'badge-green' : score >= 45 ? 'badge-blue' : 'badge-red';
  return <span className={`badge ${cls}`}>{score}%</span>;
}

function PriBadge({ pri }: { pri?: number }) {
  if (!pri) return null;
  const colors = ['', 'badge-red', 'badge-pink', 'badge-blue', 'badge-gray', 'badge-gray'];
  const labels = ['', 'P1', 'P2', 'P3', 'P4', 'P5'];
  return <span className={`badge ${colors[pri] ?? 'badge-gray'}`}>{labels[pri]}</span>;
}

export default function PipelinePage() {
  const [editais, setEditais] = useState<Edital[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toasts, push: toast, remove: closeToast } = useToasts();

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/proxy/editais?limit=200');
      if (r.ok) setEditais(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Esc clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirm && selected.size > 0) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, confirm]);

  async function moveTo(edital: Edital, newStage: string) {
    if (moving) return;
    setMoving(edital.edital_id);
    try {
      await fetch(`/api/proxy/editais/${edital.edital_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fase_atual: newStage, autor_email: 'pipeline' }),
      });
      await load();
    } finally {
      setMoving(null);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectStage(stageKey: string) {
    const stageIds = editais.filter((e) => e.fase_atual === stageKey && !e.estado_terminal).map((e) => e.edital_id);
    if (stageIds.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = stageIds.every((id) => next.has(id));
      if (allIn) stageIds.forEach((id) => next.delete(id));
      else stageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function performDelete(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    setRemovingIds(new Set(ids));
    try {
      const r = await fetch('/api/proxy/editais/bulk_delete', {
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
      else toast('success', deleted === 1 ? 'Edital apagado' : `${deleted} editais apagados`);
    } catch (e: any) {
      toast('error', `Falha ao apagar: ${e.message || e}`);
    } finally {
      setRemovingIds(new Set());
      setDeleting(false);
      setConfirm(null);
    }
  }

  function askDeleteOne(edital: Edital) {
    setConfirm({
      ids: [edital.edital_id],
      label: edital.orgao || edital.numero_pregao || edital.edital_id,
    });
  }

  function askDeleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setConfirm({ ids, label: `${ids.length} editais` });
  }

  const byStage = useCallback((stage: string) =>
    editais.filter((e) => e.fase_atual === stage && !e.estado_terminal),
  [editais]);
  const terminal = useMemo(() => editais.filter((e) => !!e.estado_terminal), [editais]);
  const hasSelection = selected.size > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm gap-3">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Carregando pipeline…
      </div>
    );
  }

  const activeCount = editais.filter(e => !e.estado_terminal).length;
  const aptoCount   = editais.filter(e => e.score_comercial != null && e.score_comercial >= 70).length;

  return (
    <div className={`space-y-6 animate-fade-in ${hasSelection ? 'has-selection' : ''}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-poppins font-bold text-2xl md:text-3xl text-white">Pipeline de Editais</h1>
          <p className="text-sm text-slate-400 mt-1">
            {activeCount} em andamento · {aptoCount} APTO (score ≥ 70)
          </p>
        </div>
        <Link href="/upload" className="btn btn-primary shrink-0">+ Novo edital</Link>
      </div>

      {/* Bulk action bar (sticky) */}
      <BulkActionBar
        count={selected.size}
        busy={deleting}
        onClear={() => setSelected(new Set())}
        onDelete={askDeleteSelected}
      />

      {/* Kanban */}
      <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-2.5 min-w-max">
          {STAGES.map((stage, idx) => {
            const cards   = byStage(stage.key);
            const prevStage = idx > 0 ? STAGES[idx - 1].key : null;
            const nextStage = idx < STAGES.length - 1 ? STAGES[idx + 1].key : null;
            const stageIds = cards.map((c) => c.edital_id);
            const allStageSelected = stageIds.length > 0 && stageIds.every((id) => selected.has(id));
            return (
              <div key={stage.key} className="stage-col w-56">
                <div className="stage-col-title">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span>{stage.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {cards.length > 0 && (
                      <button
                        type="button"
                        onClick={() => selectStage(stage.key)}
                        className="stage-col-select"
                        title={allStageSelected ? 'Desmarcar todos do estágio' : 'Selecionar todos do estágio'}
                      >
                        {allStageSelected ? '✕ todos' : '☐ todos'}
                      </button>
                    )}
                    <span className="bg-white/[0.08] text-slate-400 rounded-full px-2 py-0.5 text-[10px] font-mono">
                      {cards.length}
                    </span>
                  </div>
                </div>
                {cards.map((e) => {
                  const isSelected = selected.has(e.edital_id);
                  const isRemoving = removingIds.has(e.edital_id);
                  return (
                    <div
                      key={e.edital_id}
                      className={`kanban-card group relative ${isSelected ? 'is-selected' : ''} ${isRemoving ? 'card-removing' : ''}`}
                    >
                      {/* Selection dot — top-left */}
                      <div className="absolute top-2 left-2">
                        <SelectDot checked={isSelected} onChange={() => toggleSelected(e.edital_id)} />
                      </div>
                      {/* Trash — top-right */}
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); askDeleteOne(e); }}
                        disabled={deleting}
                        title="Apagar edital"
                        aria-label="Apagar edital"
                        className="card-trash"
                      >
                        <TrashIcon />
                      </button>

                      <Link href={`/edital/${e.edital_id}`} className="block mb-2 pl-7 pr-6">
                        <p className="text-xs font-semibold text-white leading-snug line-clamp-2 mb-0.5 group-hover:text-primary-light transition-colors">
                          {e.orgao || '—'}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">{e.objeto || 'sem objeto'}</p>
                      </Link>
                      <div className="flex items-center gap-1 flex-wrap pl-7">
                        {e.uf && <span className="badge badge-gray text-[10px] px-1.5 py-0">{e.uf}</span>}
                        <ScoreBadge score={e.score_comercial} />
                        <PriBadge pri={e.prioridade} />
                      </div>
                      {/* Move buttons */}
                      <div className="hidden group-hover:flex gap-1 mt-2 pt-2 border-t border-white/[0.06]">
                        {prevStage && (
                          <button
                            onClick={() => moveTo(e, prevStage)}
                            disabled={moving === e.edital_id}
                            className="text-[10px] btn btn-ghost px-2 py-0.5 opacity-60 hover:opacity-100"
                          >
                            ← {STAGES[idx-1].label}
                          </button>
                        )}
                        {nextStage && (
                          <button
                            onClick={() => moveTo(e, nextStage)}
                            disabled={moving === e.edital_id}
                            className="text-[10px] btn btn-primary px-2 py-0.5 ml-auto"
                          >
                            {STAGES[idx+1].label} →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && (
                  <div className="text-[11px] text-slate-600 text-center py-6 border border-dashed border-white/[0.08] rounded-xl bg-white/[0.01]">
                    Nenhum processo
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal / Encerrados */}
      {terminal.length > 0 && (
        <details className="accordion">
          <summary>
            <span>Encerrados <span className="ml-1.5 text-slate-400 font-normal">({terminal.length})</span></span>
            <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="accordion-body overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                  <th className="pb-2 pr-2 w-8"></th>
                  <th className="pb-2 pr-4 font-normal">Órgão</th>
                  <th className="pb-2 pr-4 font-normal">UF</th>
                  <th className="pb-2 pr-4 font-normal">Objeto</th>
                  <th className="pb-2 pr-3 font-normal">Estado</th>
                  <th className="pb-2 pr-2 font-normal">Score</th>
                  <th className="pb-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {terminal.map((e) => {
                  const isSelected = selected.has(e.edital_id);
                  return (
                  <tr key={e.edital_id} className={`group border-b border-slate-100 hover:bg-slate-50 transition-colors ${isSelected ? 'is-selected bg-white/[0.03]' : ''}`}>
                    <td className="py-2.5 pr-2">
                      <SelectDot checked={isSelected} onChange={() => toggleSelected(e.edital_id)} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <Link href={`/edital/${e.edital_id}`} className="text-slate-700 hover:text-slate-900 transition-colors">
                        {e.orgao}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500">{e.uf}</td>
                    <td className="py-2.5 pr-4 max-w-xs truncate text-slate-500">{e.objeto}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`badge ${TERMINAL_COLORS[e.estado_terminal!] ?? 'badge-gray'}`}>
                        {e.estado_terminal}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2"><ScoreBadge score={e.score_comercial} /></td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => askDeleteOne(e)}
                        disabled={deleting}
                        title="Apagar edital"
                        className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        open={!!confirm}
        busy={deleting}
        title={confirm && confirm.ids.length > 1 ? `Apagar ${confirm.ids.length} editais?` : 'Apagar edital?'}
        message={
          confirm && confirm.ids.length > 1 ? (
            <>
              Esta ação removerá <strong className="text-white">{confirm.ids.length}</strong> editais do pipeline.
              <br />Não poderá ser desfeita.
            </>
          ) : (
            <>
              Esta ação removerá <strong className="text-white">{confirm?.label}</strong> do pipeline.
              <br />Não poderá ser desfeita.
            </>
          )
        }
        confirmLabel={confirm && confirm.ids.length > 1 ? `Apagar ${confirm.ids.length}` : 'Apagar'}
        onCancel={() => !deleting && setConfirm(null)}
        onConfirm={() => confirm && performDelete(confirm.ids)}
      />

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}
