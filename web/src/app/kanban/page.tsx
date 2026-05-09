'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';

type Edital = {
  edital_id: string;
  orgao: string;
  uf?: string;
  numero_pregao?: string;
  objeto?: string;
  valor_estimado?: number;
  data_encerramento?: string;
  vendedor_email?: string;
  prioridade?: number;
  score_comercial?: number;
  classificacao?: string;
  risco?: string;
  fase_atual?: string;
  estado_terminal?: string;
  kanban_column_id?: string | null;
  kanban_order?: number;
};

type Column = {
  column_id: string;
  nome: string;
  cor: string;
  order_idx: number;
};

type Board = {
  columns: Column[];
  editais_by_column: Record<string, Edital[]>;
};

const UNASSIGNED = '__unassigned__';

function fmtMoeda(v?: number): string {
  if (!v || v < 1) return '';
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function CardEdital({ ed, dragging }: { ed: Edital; dragging?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ed.edital_id,
    data: { edital: ed },
  });
  const opacity = isDragging || dragging ? 0.4 : 1;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity }}
      className="kanban-card"
    >
      <Link
        href={`/edital/${ed.edital_id}`}
        onClick={(e) => e.stopPropagation()}
        className="block"
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <span className="font-semibold text-sm text-slate-900 line-clamp-2 leading-tight">
            {ed.orgao || 'Sem órgão'}
          </span>
          {ed.score_comercial != null && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{
                background: ed.score_comercial >= 70 ? 'rgba(22,163,74,0.12)' : ed.score_comercial >= 40 ? 'rgba(217,119,6,0.12)' : 'rgba(225,72,73,0.12)',
                color: ed.score_comercial >= 70 ? '#16A34A' : ed.score_comercial >= 40 ? '#D97706' : '#E14849',
              }}
            >
              {ed.score_comercial}
            </span>
          )}
        </div>
        {ed.objeto && (
          <p className="text-xs text-slate-600 line-clamp-2 mb-2 leading-relaxed">
            {ed.objeto}
          </p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ed.uf && (
            <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
              {ed.uf}
            </span>
          )}
          {ed.numero_pregao && (
            <span className="text-[10px] text-slate-500 truncate">
              {ed.numero_pregao}
            </span>
          )}
          {fmtMoeda(ed.valor_estimado) && (
            <span className="text-[10px] font-semibold text-emerald-700 ml-auto">
              {fmtMoeda(ed.valor_estimado)}
            </span>
          )}
        </div>
        {(ed.data_encerramento || ed.vendedor_email) && (
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100">
            {ed.vendedor_email ? (
              <span className="text-[10px] text-slate-500 truncate">
                {ed.vendedor_email.split('@')[0]}
              </span>
            ) : <span/>}
            {ed.data_encerramento && (
              <span className="text-[10px] text-slate-500">
                até {fmtDate(ed.data_encerramento)}
              </span>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}

function ColumnDroppable({
  column, editais, onRename, onDelete, onChangeColor,
}: {
  column: Column | { column_id: string; nome: string; cor: string };
  editais: Edital[];
  onRename?: (id: string, nome: string) => void;
  onDelete?: (id: string) => void;
  onChangeColor?: (id: string, cor: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.column_id });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.nome);
  const isUnassigned = column.column_id === UNASSIGNED;

  return (
    <div
      ref={setNodeRef}
      className="kanban-column"
      style={{
        background: isOver ? 'rgba(4,126,169,0.05)' : '#F8FAFC',
        borderTop: `3px solid ${column.cor}`,
      }}
    >
      <div className="kanban-column-header">
        {editing && !isUnassigned ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name && name !== column.nome) onRename?.(column.column_id, name); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setEditing(false); if (name && name !== column.nome) onRename?.(column.column_id, name); }
              if (e.key === 'Escape') { setEditing(false); setName(column.nome); }
            }}
            className="bg-transparent border-b border-slate-300 outline-none text-sm font-bold text-slate-900 flex-1 min-w-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => !isUnassigned && setEditing(true)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-70 transition-opacity"
            disabled={isUnassigned}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: column.cor }}
            />
            <span className="font-bold text-sm text-slate-900 truncate">
              {column.nome}
            </span>
            <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-1.5 rounded">
              {editais.length}
            </span>
          </button>
        )}
        {!isUnassigned && (
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="color"
              value={column.cor}
              onChange={(e) => onChangeColor?.(column.column_id, e.target.value)}
              className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
              title="Mudar cor"
            />
            <button
              onClick={() => {
                if (editais.length > 0) {
                  if (!confirm(`Excluir coluna "${column.nome}"? Os ${editais.length} editais voltam para "Sem coluna".`)) return;
                } else {
                  if (!confirm(`Excluir coluna "${column.nome}"?`)) return;
                }
                onDelete?.(column.column_id);
              }}
              className="text-slate-400 hover:text-red-500 text-xs px-1 transition-colors"
              title="Excluir coluna"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="kanban-column-body custom-scrollbar">
        {editais.length === 0 ? (
          <div className="text-xs text-slate-400 italic text-center py-8 px-2">
            Arraste editais para cá
          </div>
        ) : (
          editais.map((ed) => <CardEdital key={ed.edital_id} ed={ed} />)
        )}
      </div>
    </div>
  );
}

export default function KanbanPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeEdital, setActiveEdital] = useState<Edital | null>(null);
  const [creating, setCreating] = useState(false);
  const [newColName, setNewColName] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/proxy/kanban', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setBoard(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar kanban');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDragStart = (e: DragStartEvent) => {
    const ed = e.active.data.current?.edital as Edital | undefined;
    if (ed) setActiveEdital(ed);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveEdital(null);
    const editalId = String(e.active.id);
    const targetColId = e.over?.id ? String(e.over.id) : null;
    if (!targetColId || !board) return;

    // Optimistic update
    setBoard((prev) => {
      if (!prev) return prev;
      const newByCol: Record<string, Edital[]> = {};
      let movedCard: Edital | undefined;
      for (const [cid, cards] of Object.entries(prev.editais_by_column)) {
        newByCol[cid] = cards.filter((c) => {
          if (c.edital_id === editalId) { movedCard = c; return false; }
          return true;
        });
      }
      if (movedCard) {
        const updated: Edital = { ...movedCard, kanban_column_id: targetColId === UNASSIGNED ? null : targetColId };
        if (!newByCol[targetColId]) newByCol[targetColId] = [];
        newByCol[targetColId] = [updated, ...newByCol[targetColId]];
      }
      return { ...prev, editais_by_column: newByCol };
    });

    // Persist
    try {
      await fetch(`/api/proxy/editais/${editalId}/kanban`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ column_id: targetColId === UNASSIGNED ? null : targetColId, order_idx: 0 }),
      });
    } catch {
      load();
    }
  };

  async function createColumn() {
    const nome = newColName.trim();
    if (!nome) return;
    setNewColName('');
    setCreating(false);
    await fetch('/api/proxy/kanban/columns', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome, cor: '#94A3B8' }),
    });
    await load();
  }

  async function renameColumn(id: string, nome: string) {
    await fetch(`/api/proxy/kanban/columns/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome }),
    });
    await load();
  }

  async function changeColor(id: string, cor: string) {
    await fetch(`/api/proxy/kanban/columns/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cor }),
    });
    await load();
  }

  async function deleteColumn(id: string) {
    await fetch(`/api/proxy/kanban/columns/${id}`, { method: 'DELETE' });
    await load();
  }

  if (error) {
    return (
      <div className="alert-danger max-w-lg mx-auto mt-16">{error}</div>
    );
  }
  if (!board) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-3">
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Carregando kanban…
      </div>
    );
  }

  const unassigned = board.editais_by_column[UNASSIGNED] || [];

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-slate-200 bg-white flex items-center gap-3">
        <h1 className="heading-xl mr-auto">Kanban de Editais</h1>
        <Link href="/upload" className="btn btn-secondary btn-sm">+ Novo Edital</Link>
        {creating ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createColumn(); if (e.key === 'Escape') { setCreating(false); setNewColName(''); } }}
              placeholder="Nome da coluna"
              className="text-sm px-2.5 py-1.5 border border-slate-200 rounded-md focus:border-[#047EA9] focus:outline-none focus:ring-2 focus:ring-[#047EA9]/15"
            />
            <button onClick={createColumn} className="btn btn-primary btn-sm">OK</button>
            <button onClick={() => { setCreating(false); setNewColName(''); }} className="btn btn-ghost btn-sm">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm">+ Coluna</button>
        )}
      </div>

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-x-auto overflow-y-hidden bg-slate-50">
          <div className="flex gap-3 p-4 h-full">
            {board.columns.map((col) => (
              <ColumnDroppable
                key={col.column_id}
                column={col}
                editais={board.editais_by_column[col.column_id] || []}
                onRename={renameColumn}
                onDelete={deleteColumn}
                onChangeColor={changeColor}
              />
            ))}
            {unassigned.length > 0 && (
              <ColumnDroppable
                column={{ column_id: UNASSIGNED, nome: 'Sem coluna', cor: '#94A3B8' }}
                editais={unassigned}
              />
            )}
          </div>
        </div>
        <DragOverlay>
          {activeEdital && <CardEdital ed={activeEdital} />}
        </DragOverlay>
      </DndContext>

      <style jsx global>{`
        .kanban-column {
          width: 280px;
          min-width: 280px;
          height: 100%;
          background: #F8FAFC;
          border: 1px solid rgba(15,23,42,0.08);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(15,23,42,0.04);
          transition: background 0.15s;
        }
        .kanban-column-header {
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid rgba(15,23,42,0.06);
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(8px);
          flex-shrink: 0;
        }
        .kanban-column-body {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .kanban-card {
          background: #FFFFFF;
          border: 1px solid rgba(15,23,42,0.08);
          border-radius: 10px;
          padding: 10px;
          cursor: grab;
          transition: all 0.15s ease;
          box-shadow: 0 1px 3px rgba(15,23,42,0.05);
        }
        .kanban-card:hover {
          border-color: rgba(4,126,169,0.3);
          box-shadow: 0 4px 12px rgba(15,23,42,0.08);
          transform: translateY(-1px);
        }
        .kanban-card:active {
          cursor: grabbing;
        }
      `}</style>
    </div>
  );
}
