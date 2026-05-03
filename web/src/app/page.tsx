'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
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
  comentarios_count?: number;
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

// ── Droppable Kanban Column ───────────────────────────────────────────────────
function KanbanColumn({
  stage, cards, idx, prevStage, nextStage,
  allStageSelected, selected, removingIds, moving, deleting,
  onSelectAll, onToggle, onMoveTo, onDelete,
}: {
  stage: { key: string; label: string; color: string };
  cards: Edital[];
  idx: number;
  prevStage: string | null;
  nextStage: string | null;
  allStageSelected: boolean;
  selected: Set<string>;
  removingIds: Set<string>;
  moving: string | null;
  deleting: boolean;
  onSelectAll: () => void;
  onToggle: (id: string) => void;
  onMoveTo: (e: Edital, stage: string) => void;
  onDelete: (e: Edital) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });

  return (
    <div
      ref={setNodeRef}
      className="stage-col"
      data-drop-target={isOver ? 'true' : undefined}
    >
      <div className="stage-col-title">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <span>{stage.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {cards.length > 0 && (
            <button
              type="button"
              onClick={onSelectAll}
              className="stage-col-select"
              title={allStageSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            >
              {allStageSelected ? '✕' : '☐'}
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
            <div className="absolute top-1.5 left-1.5">
              <SelectDot checked={isSelected} onChange={() => onToggle(e.edital_id)} />
            </div>
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onDelete(e); }}
              disabled={deleting}
              title="Apagar edital"
              aria-label="Apagar edital"
              className="card-trash"
            >
              <TrashIcon />
            </button>

            <Link href={`/edital/${e.edital_id}`} className="block mb-1.5 pl-6 pr-5">
              <p className="text-[12px] font-semibold text-white leading-snug line-clamp-2 mb-0.5 group-hover:text-cyan-400 transition-colors">
                {e.orgao || '—'}
              </p>
              <p className="text-[11px] text-slate-500 truncate">{e.objeto || 'sem objeto'}</p>
            </Link>
            <div className="flex items-center gap-1 flex-wrap pl-6">
              {e.uf && <span className="badge badge-gray text-[10px] px-1.5 py-0">{e.uf}</span>}
              <ScoreBadge score={e.score_comercial} />
              <PriBadge pri={e.prioridade} />
            </div>
            {/* Move buttons + comment count */}
            <div className="hidden group-hover:flex gap-1 mt-2 pt-2 border-t border-white/[0.06] items-center">
              {prevStage && (
                <button
                  onClick={() => onMoveTo(e, prevStage)}
                  disabled={moving === e.edital_id}
                  className="text-[10px] btn btn-ghost px-2 py-0.5 opacity-60 hover:opacity-100"
                >
                  ← {STAGES[idx - 1].label}
                </button>
              )}
              {nextStage && (
                <button
                  onClick={() => onMoveTo(e, nextStage)}
                  disabled={moving === e.edital_id}
                  className="text-[10px] btn btn-primary px-2 py-0.5 ml-auto"
                >
                  {STAGES[idx + 1].label} →
                </button>
              )}
            </div>
            {/* Comment count (always visible when > 0) */}
            {(e.comentarios_count ?? 0) > 0 && (
              <Link
                href={`/edital/${e.edital_id}#comentarios`}
                onClick={(ev) => ev.stopPropagation()}
                className="flex items-center gap-1 text-[10px] text-white/30 hover:text-cyan-400 transition-colors mt-1.5 pl-6"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                </svg>
                {e.comentarios_count}
              </Link>
            )}
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

  // ── Search & filter state ──────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterPri, setFilterPri] = useState<number | null>(null);
  const [filterUF, setFilterUF] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/proxy/editais?limit=200');
      if (r.ok) setEditais(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtered data (search + chips) ────────────────────────────────────────
  const filteredEditais = useMemo(() => {
    let result = editais;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          (e.orgao || '').toLowerCase().includes(q) ||
          (e.objeto || '').toLowerCase().includes(q) ||
          (e.numero_pregao || '').toLowerCase().includes(q) ||
          (e.vendedor_email || '').toLowerCase().includes(q)
      );
    }
    if (filterPri != null) result = result.filter((e) => e.prioridade === filterPri);
    if (filterUF)           result = result.filter((e) => e.uf === filterUF);
    return result;
  }, [editais, search, filterPri, filterUF]);

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

  async function performBulkUpdate(fields: Record<string, unknown>) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const r = await fetch('/api/proxy/editais/bulk_update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, fields }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('error', err.detail ?? `Falha HTTP ${r.status}`);
      return;
    }
    const out = await r.json().catch(() => ({}));
    await load();
    toast('success', `${out.updated ?? ids.length} edital(ais) atualizado(s)`);
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
    filteredEditais.filter((e) => e.fase_atual === stage && !e.estado_terminal),
  [filteredEditais]);
  const terminal = useMemo(() => filteredEditais.filter((e) => !!e.estado_terminal), [filteredEditais]);
  const hasSelection = selected.size > 0;

  // ── Drag-and-drop state ───────────────────────────────────────────────────
  const [activeCard, setActiveCard] = useState<Edital | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const card = editais.find((e) => e.edital_id === event.active.id);
    if (card) setActiveCard(card);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;
    const edital = editais.find((e) => e.edital_id === active.id);
    if (!edital || edital.fase_atual === over.id) return;
    const newStage = String(over.id);
    if (!STAGES.find((s) => s.key === newStage)) return;
    await moveTo(edital, newStage);
  }

  // Derived UF list for filter chips
  const ufList = useMemo(() => {
    const ufs = [...new Set(editais.map((e) => e.uf).filter(Boolean))].sort();
    return ufs as string[];
  }, [editais]);

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
  const waitingCount = editais.filter(e => !e.estado_terminal && !e.score_comercial).length;

  return (
    <div className={`space-y-4 animate-fade-in ${hasSelection ? 'has-selection' : ''}`}>
      {/* ── Hero ── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="fade-up">
            <h1 className="heading-xl">Pipeline de Editais</h1>
            <p className="text-sm text-white/40 mt-1.5">
              <span className="text-white/70 font-medium">{activeCount}</span> em andamento
              {' · '}
              <span style={{ color: 'var(--x-green)' }} className="font-medium">{aptoCount} APTO</span>
              {waitingCount > 0 && <> · <span className="text-white/40">{waitingCount} aguardando análise</span></>}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 fade-up delay-100">
            <button
              type="button"
              onClick={() => setShowSearch((v) => !v)}
              title="Buscar"
              className={`btn btn-ghost px-3 py-2 ${showSearch ? 'bg-white/[0.06]' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </button>
            <Link href="/upload" className="btn btn-primary shrink-0 text-sm">
              + Novo edital
            </Link>
          </div>
        </div>

        {/* Search bar (collapsible) */}
        {showSearch && (
          <div className="fade-up">
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por órgão, objeto, número, vendedor…"
              className="input w-full text-sm"
              style={{ borderColor: search ? 'rgba(0,190,255,0.4)' : undefined }}
            />
          </div>
        )}

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2 fade-up delay-100">
          <span className="text-[11px] uppercase tracking-wider text-white/25 font-medium">Filtrar:</span>

          {/* UF chips */}
          {ufList.slice(0, 6).map((uf) => (
            <button
              key={uf}
              type="button"
              onClick={() => setFilterUF(filterUF === uf ? null : uf)}
              className={`text-xs px-2.5 py-0.5 rounded-full border transition-all duration-150 ${
                filterUF === uf
                  ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-400'
                  : 'border-white/[0.1] text-white/40 hover:border-white/25 hover:text-white/60'
              }`}
            >
              {uf}
            </button>
          ))}

          {/* Priority chips */}
          {([1, 2, 3] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setFilterPri(filterPri === p ? null : p)}
              className={`text-xs px-2.5 py-0.5 rounded-full border transition-all duration-150 ${
                filterPri === p
                  ? 'bg-pink-500/15 border-pink-500/50 text-pink-400'
                  : 'border-white/[0.1] text-white/40 hover:border-white/25 hover:text-white/60'
              }`}
            >
              P{p}
            </button>
          ))}

          {/* Clear filters */}
          {(filterPri != null || filterUF || search) && (
            <button
              type="button"
              onClick={() => { setFilterPri(null); setFilterUF(null); setSearch(''); }}
              className="text-xs px-2.5 py-0.5 rounded-full border border-white/[0.1] text-white/30 hover:text-red-400 hover:border-red-500/30 transition-all"
            >
              ✕ limpar
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar (sticky) */}
      <BulkActionBar
        count={selected.size}
        busy={deleting}
        onClear={() => setSelected(new Set())}
        onDelete={askDeleteSelected}
        onBulkUpdate={performBulkUpdate}
      />

      {/* Kanban (drag-and-drop) */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
          <div className="flex gap-2 min-w-max">
            {STAGES.map((stage, idx) => {
              const cards   = byStage(stage.key);
              const prevStage = idx > 0 ? STAGES[idx - 1].key : null;
              const nextStage = idx < STAGES.length - 1 ? STAGES[idx + 1].key : null;
              const stageIds = cards.map((c) => c.edital_id);
              const allStageSelected = stageIds.length > 0 && stageIds.every((id) => selected.has(id));
              return (
                <KanbanColumn
                  key={stage.key}
                  stage={stage}
                  cards={cards}
                  idx={idx}
                  prevStage={prevStage}
                  nextStage={nextStage}
                  allStageSelected={allStageSelected}
                  selected={selected}
                  removingIds={removingIds}
                  moving={moving}
                  deleting={deleting}
                  onSelectAll={() => selectStage(stage.key)}
                  onToggle={toggleSelected}
                  onMoveTo={moveTo}
                  onDelete={askDeleteOne}
                />
              );
            })}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeCard ? (
            <div
              className="kanban-card shadow-2xl"
              style={{
                width: 172,
                transform: 'rotate(3deg) scale(1.04)',
                boxShadow: '0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px var(--x-cyan), 0 0 32px rgba(0,190,255,0.25)',
                borderColor: 'var(--x-cyan)',
                background: 'rgba(0,0,0,0.7)',
                cursor: 'grabbing',
              }}
            >
              <div className="px-2 py-1.5">
                <p className="text-[12px] font-semibold text-white line-clamp-2 mb-0.5">{activeCard.orgao || '—'}</p>
                <p className="text-[11px] text-slate-500 truncate">{activeCard.objeto || 'sem objeto'}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  {activeCard.uf && <span className="badge badge-gray text-[10px] px-1.5 py-0">{activeCard.uf}</span>}
                  <ScoreBadge score={activeCard.score_comercial} />
                  <PriBadge pri={activeCard.prioridade} />
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
