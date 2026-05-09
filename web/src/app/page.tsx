'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
import ScoreIndicator from '@/components/ui/ScoreIndicator';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import DashboardKpis from '@/components/dashboard-kpis';

const STAGES: { key: string; label: string; color: string; bg: string }[] = [
  { key: 'identificacao',  label: 'Identificação',    color: '#94A3B8', bg: 'rgba(148,163,184,0.1)' },
  { key: 'analise',        label: 'Análise de IA',    color: '#047EA9', bg: 'rgba(4,126,169,0.1)' },
  { key: 'pre_disputa',    label: 'Pré-disputa',      color: '#A85CA9', bg: 'rgba(168,92,169,0.1)' },
  { key: 'proposta',       label: 'Proposta',         color: '#00BEFF', bg: 'rgba(0,190,255,0.1)' },
  { key: 'disputa',        label: 'Disputa',          color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  { key: 'habilitacao',    label: 'Habilitação',      color: '#7FA856', bg: 'rgba(127,168,86,0.1)' },
  { key: 'at_declinados',  label: 'At. Declinados',   color: '#E14849', bg: 'rgba(225,72,73,0.1)' },
  { key: 'recursos',       label: 'Recursos',         color: '#F97316', bg: 'rgba(249,115,22,0.1)' },
  { key: 'homologado',     label: 'Homologado',       color: '#7FA856', bg: 'rgba(127,168,86,0.1)' },
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
  valor_estimado?: number;
};

function PriBadge({ pri }: { pri?: number }) {
  if (!pri) return null;
  const colors = ['', 'badge-red', 'badge-pink', 'badge-blue', 'badge-gray', 'badge-gray'];
  const labels = ['', 'P1', 'P2', 'P3', 'P4', 'P5'];
  return <span className={`badge ${colors[pri] ?? 'badge-gray'}`}>{labels[pri]}</span>;
}

// ── Command Palette (\u2318K) ──────────────────────────────────────────────────────
const CMD_NAV = [
  { icon: '◈', label: 'Pipeline',         href: '/' },
  { icon: '+', label: 'Novo edital',       href: '/upload' },
  { icon: '≡', label: 'Histórico',         href: '/historico' },
  { icon: '◎', label: 'Chat IA',           href: '/chat' },
  { icon: '⊙', label: 'Status do sistema', href: '/status' },
  { icon: '?', label: 'Como funciona',     href: '/como-funciona' },
];

function CommandPalette({ editais, onClose }: { editais: Edital[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const editalHits = q.trim()
    ? editais.filter(e =>
        (e.orgao || '').toLowerCase().includes(q.toLowerCase()) ||
        (e.objeto || '').toLowerCase().includes(q.toLowerCase()) ||
        (e.numero_pregao || '').toLowerCase().includes(q.toLowerCase())
      ).slice(0, 6)
    : [];

  const navHits = CMD_NAV.filter(n =>
    !q.trim() || n.label.toLowerCase().includes(q.toLowerCase())
  );

  const all: Array<{ type: 'edital'; e: Edital } | { type: 'nav'; n: typeof CMD_NAV[number] }> = [
    ...editalHits.map(e => ({ type: 'edital' as const, e })),
    ...navHits.map(n => ({ type: 'nav' as const, n })),
  ];

  const clampedSel = Math.min(sel, Math.max(all.length - 1, 0));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    function handle(ev: KeyboardEvent) {
      if (ev.key === 'Escape') { onClose(); return; }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); setSel(s => Math.min(s + 1, all.length - 1)); }
      if (ev.key === 'ArrowUp')   { ev.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      if (ev.key === 'Enter') {
        const item = all[clampedSel];
        if (!item) return;
        if (item.type === 'nav') window.location.href = item.n.href;
        else window.location.href = `/edital/${item.e.edital_id}`;
        onClose();
      }
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [all, clampedSel, onClose]);

  return (
    <div className="cmd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-modal">
        <div className="cmd-input-row">
          <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Buscar editais, páginas, ações…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <kbd className="cmd-kbd">ESC</kbd>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {all.length === 0 && (
          <p className="text-center text-sm py-10 text-slate-300">Nenhum resultado para "{q}"</p>
          )}

          {editalHits.length > 0 && (
            <>
              <p className="cmd-section-label">Editais</p>
              {editalHits.map((e, i) => (
                <a key={e.edital_id} href={`/edital/${e.edital_id}`}
                  className={`cmd-item ${clampedSel === i ? 'cmd-item-active' : ''}`}
                  onClick={onClose}
                >
                  <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--x-cyan)', opacity: 0.7 }}>⬡</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate text-slate-700">{e.orgao}</p>
                    <p className="text-[11px] truncate text-slate-400">{e.objeto || 'sem objeto'}</p>
                  </div>
                  <ScoreIndicator score={e.score_comercial} size="sm" thresholds={{ good: 70, warning: 45 }} />
                </a>
              ))}
            </>
          )}

          {navHits.length > 0 && (
            <>
              <p className="cmd-section-label" style={{ marginTop: editalHits.length ? 4 : 0 }}>Navegação</p>
              {navHits.map((n, i) => {
                const idx = editalHits.length + i;
                return (
                  <a key={n.href} href={n.href}
                    className={`cmd-item ${clampedSel === idx ? 'cmd-item-active' : ''}`}
                    onClick={onClose}
                  >
                    <span className="w-6 h-6 flex items-center justify-center text-xs rounded-lg font-mono shrink-0"
                      style={{ background: 'rgba(4,126,169,0.08)', color: '#047EA9' }}>
                      {n.icon}
                    </span>
                    <span className="text-sm">{n.label}</span>
                  </a>
                );
              })}
            </>
          )}
        </div>

        <div className="cmd-footer">
          <span><kbd className="cmd-kbd">↑↓</kbd> navegar</span>
          <span><kbd className="cmd-kbd">↵</kbd> abrir</span>
          <span><kbd className="cmd-kbd">ESC</kbd> fechar</span>
          <span className="ml-auto opacity-60">⌘K</span>
        </div>
      </div>
    </div>
  );
}

// ── Chat Link Modal ───────────────────────────────────────────────────────────
type ChatSession = { session_id: string; title: string; updated_at: string; message_count: number };

function ChatLinkModal({ edital, onClose }: { edital: Edital; onClose: () => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [allSessions, setAllSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [tab, setTab] = useState<'linked' | 'all'>('linked');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [linked, all] = await Promise.all([
        fetch(`/api/proxy/editais/${edital.edital_id}/chat-sessions`).then(r => r.ok ? r.json() : []),
        fetch('/api/proxy/chat/sessions?limit=30').then(r => r.ok ? r.json() : []),
      ]);
      setSessions(linked);
      setAllSessions(all.filter((s: ChatSession) => !linked.find((l: ChatSession) => l.session_id === s.session_id)));
      setLoading(false);
    }
    load();
  }, [edital.edital_id]);

  async function linkSession(sessionId: string) {
    setLinking(sessionId);
    try {
      await fetch(`/api/proxy/chat/sessions/${sessionId}/link-edital`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ edital_id: edital.edital_id }),
      });
      // Refresh
      const [linked, all] = await Promise.all([
        fetch(`/api/proxy/editais/${edital.edital_id}/chat-sessions`).then(r => r.json()),
        fetch('/api/proxy/chat/sessions?limit=30').then(r => r.json()),
      ]);
      setSessions(linked);
      setAllSessions(all.filter((s: ChatSession) => !linked.find((l: ChatSession) => l.session_id === s.session_id)));
    } finally { setLinking(null); }
  }

  async function unlinkSession(sessionId: string) {
    setLinking(sessionId);
    try {
      await fetch(`/api/proxy/chat/sessions/${sessionId}/link-edital`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ edital_id: null }),
      });
      setSessions(prev => prev.filter(s => s.session_id !== sessionId));
      const s = sessions.find(x => x.session_id === sessionId);
      if (s) setAllSessions(prev => [s, ...prev]);
    } finally { setLinking(null); }
  }

  async function newLinkedChat() {
    const res = await fetch(`/api/proxy/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `Chat — ${edital.orgao}`, edital_id: edital.edital_id }),
    });
    if (res.ok) {
      const sess = await res.json();
      window.location.href = `/chat?session=${sess.session_id}`;
    }
  }

  const listed = tab === 'linked' ? sessions : allSessions;

  return (
    <div className="chat-link-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="chat-link-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div>
            <p className="text-sm font-semibold text-slate-800">Conversas vinculadas</p>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[220px]">{edital.orgao}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 pt-3 gap-3">
          <button
            className={`text-xs font-medium pb-2 border-b-2 transition-colors ${tab === 'linked' ? 'border-[#047EA9] text-[#047EA9]' : 'border-transparent text-slate-400'}`}
            onClick={() => setTab('linked')}
          >
            Vinculadas {sessions.length > 0 && <span className="ml-1 bg-[#047EA9] text-white rounded-full px-1.5 py-0.5 text-[9px]">{sessions.length}</span>}
          </button>
          <button
            className={`text-xs font-medium pb-2 border-b-2 transition-colors ${tab === 'all' ? 'border-[#047EA9] text-[#047EA9]' : 'border-transparent text-slate-400'}`}
            onClick={() => setTab('all')}
          >
            Outras conversas
          </button>
        </div>

        {/* List */}
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-slate-400 text-center py-8">Carregando…</p>
          ) : listed.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">
              {tab === 'linked' ? 'Nenhuma conversa vinculada' : 'Nenhuma outra conversa disponível'}
            </p>
          ) : (
            listed.map(s => (
              <div key={s.session_id} className="chat-link-session-row">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-slate-700 truncate">{s.title || 'Sem título'}</p>
                  <p className="text-[10px] text-slate-400">{s.message_count} mensagens</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`/chat?session=${s.session_id}`}
                    className="text-[10px] text-[#047EA9] hover:underline"
                    onClick={onClose}
                  >
                    Abrir
                  </a>
                  {tab === 'linked' ? (
                    <button
                      onClick={() => unlinkSession(s.session_id)}
                      disabled={linking === s.session_id}
                      className="text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {linking === s.session_id ? '…' : 'Desvincular'}
                    </button>
                  ) : (
                    <button
                      onClick={() => linkSession(s.session_id)}
                      disabled={linking === s.session_id}
                      className="text-[10px] px-2 py-0.5 rounded border border-[#047EA9]/30 text-[#047EA9] hover:bg-[#047EA9]/05 transition-colors disabled:opacity-40"
                    >
                      {linking === s.session_id ? '…' : 'Vincular'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
          <button
            onClick={newLinkedChat}
            className="btn btn-primary w-full text-xs py-2"
          >
            + Iniciar nova conversa sobre este edital
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick Note Popover ────────────────────────────────────────────────────────
function QuickNote({ editalId, onSaved }: { editalId: string; onSaved: () => void }) {
  const [open, setOpen]   = useState(false);
  const [text, setText]   = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function save() {
    const t = text.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await fetch(`/api/proxy/editais/${editalId}/comentarios`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto: t, autor_email: 'pipeline' }),
      });
      setText('');
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        title="Adicionar nota rápida"
        onClick={() => setOpen(o => !o)}
        className="text-slate-400 hover:text-[#047EA9] transition-colors p-0.5"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-6 left-0 z-[100] w-56 rounded-xl shadow-xl p-3 space-y-2"
          style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.10)' }}>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Nota rápida</p>
          <textarea
            autoFocus
            maxLength={200}
            rows={3}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 resize-none outline-none focus:border-[#047EA9]/50 placeholder-slate-300"
            placeholder="Adicionar anotação…"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) save(); }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-300">{text.length}/200</span>
            <div className="flex gap-1.5">
              <button onClick={() => setOpen(false)} className="text-[11px] text-slate-400 hover:text-slate-700 px-2 py-0.5 rounded">Cancelar</button>
              <button
                disabled={!text.trim() || saving}
                onClick={save}
                className="text-[11px] px-2.5 py-0.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
                style={{ background: 'var(--x-cyan)', color: '#000' }}
              >
                {saving ? '…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Droppable Kanban Column ───────────────────────────────────────────────────
function KanbanColumn({
  stage, cards, idx, prevStage, nextStage,
  allStageSelected, selected, removingIds, moving, deleting,
  onSelectAll, onToggle, onMoveTo, onDelete, reload, onChatLink,
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
  reload: () => void;
  onChatLink: (e: Edital) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });

  return (
    <div
      ref={setNodeRef}
      className="stage-col"
      data-drop-target={isOver ? 'true' : undefined}
      style={{ '--stage-color': stage.color } as React.CSSProperties}
    >
      <div className="stage-col-title">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
          <span style={{ color: stage.color }}>{stage.label}</span>
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
          <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-bold tabular-nums bg-white border" style={{ color: stage.color, borderColor: `${stage.color}30` }}>
            {cards.length}
          </span>
        </div>
      </div>

      <div className="stage-cards custom-scrollbar">
      {cards.map((e) => {
        const isSelected = selected.has(e.edital_id);
        const isRemoving = removingIds.has(e.edital_id);
        return (
          <div
            key={e.edital_id}
            className={`kanban-card group relative ${isSelected ? 'is-selected' : ''} ${isRemoving ? 'card-removing' : ''}`}
            style={{ '--card-accent': stage.color } as React.CSSProperties}
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

            {/* Top row: pregão + score/priority */}
            <div className="flex items-start justify-between gap-1 mb-2 pl-5 pr-5">
              {e.numero_pregao ? (
                <span className="text-[10px] font-mono font-bold bg-[#E6F7FF] text-[#047EA9] px-2 py-0.5 rounded border border-[#BAE6FD] truncate max-w-[120px]">
                  {e.numero_pregao}
                </span>
              ) : <span />}
              <div className="flex items-center gap-1.5 shrink-0">
                <PriBadge pri={e.prioridade} />
                <ScoreIndicator score={e.score_comercial} size="sm" thresholds={{ good: 70, warning: 45 }} />
              </div>
            </div>

            {/* Body: org name + objeto */}
            <Link href={`/edital/${e.edital_id}`} className="block pl-5 pr-4 mb-3">
              <p className="text-[13px] font-heading font-semibold text-slate-800 leading-snug line-clamp-2 mb-1 group-hover:text-[#047EA9] transition-colors">
                {e.orgao || '—'}
              </p>
              <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">{e.objeto || 'sem objeto'}</p>
            </Link>

            {/* Footer: UF + value + move/actions + avatar */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 pl-5 pr-3">
              <div className="flex items-center gap-1.5">
                {e.uf && <span className="badge badge-gray text-[10px] px-1.5 py-0">{e.uf}</span>}
                {e.valor_estimado != null && (
                  <span className="text-[10px] font-mono font-semibold text-slate-500">
                    {(e.valor_estimado / 1_000_000).toFixed(1)}M
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="hidden group-hover:flex items-center gap-0.5 mr-0.5">
                  {prevStage && (
                    <button
                      onClick={() => onMoveTo(e, prevStage)}
                      disabled={moving === e.edital_id}
                      className="text-[10px] btn btn-ghost px-1.5 py-0.5 opacity-70 hover:opacity-100"
                    >
                      ←
                    </button>
                  )}
                  {nextStage && (
                    <button
                      onClick={() => onMoveTo(e, nextStage)}
                      disabled={moving === e.edital_id}
                      className="text-[10px] btn btn-primary px-1.5 py-0.5"
                    >
                      →
                    </button>
                  )}
                </div>
                {(e.comentarios_count ?? 0) > 0 && (
                  <Link
                    href={`/edital/${e.edital_id}#comentarios`}
                    onClick={(ev) => ev.stopPropagation()}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-[#047EA9] transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                    </svg>
                    {e.comentarios_count}
                  </Link>
                )}
                <QuickNote editalId={e.edital_id} onSaved={reload} />
                <button
                  type="button"
                  title="Vincular conversa do Chat"
                  onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onChatLink(e); }}
                  className="chat-link-btn"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
                  </svg>
                </button>
                <Avatar email={e.vendedor_email} name={e.orgao} size={22} />
              </div>
            </div>
          </div>
        );
      })}

      {cards.length === 0 && (
        <EmptyState
          compact
          title="Nenhum processo"
          description="Arraste editais para cá ou mude o filtro."
        />
      )}
      </div>
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
  const [cmdOpen, setCmdOpen] = useState(false);
  const [chatLinkTarget, setChatLinkTarget] = useState<Edital | null>(null);
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

  // Esc clears selection; ⌘K opens palette; header search trigger
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirm && selected.size > 0) setSelected(new Set());
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(o => !o); }
    };
    const onOpen = () => setCmdOpen(true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('openCmdPalette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('openCmdPalette', onOpen);
    };
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
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm gap-3">
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
  const totalValor  = editais.reduce((a, b) => a + (b.valor_estimado ?? 0), 0);

  return (
    <div
      className={`flex flex-col overflow-hidden animate-fade-in ${hasSelection ? 'has-selection' : ''}`}
      style={{ height: 'calc(100vh - 64px)' }}
    >
      {/* ── Top controls bar ── */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-slate-100 bg-app">
        <DashboardKpis />
        {/* Title + actions row */}
        <div className="flex items-center gap-3 mb-3">
          <h1 className="heading-xl mr-auto">Pipeline de Editais</h1>
          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            title="Filtrar por UF, prioridade…"
            className={`btn btn-ghost btn-sm flex items-center gap-1 ${showSearch || filterPri != null || filterUF ? 'bg-slate-100 text-slate-700' : ''}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M7 8h10M11 12h4" />
            </svg>
            <span className="hidden sm:inline text-[11px]">Filtrar</span>
          </button>
          <Link href="/upload" className="btn btn-primary btn-sm shrink-0">
            + Novo Edital
          </Link>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(4,126,169,0.08)' }}>
              <svg className="w-4 h-4" style={{ color: '#047EA9' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 7v7M16 7v9M12 7v4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="stat-card-value">{activeCount}</span>
              <span className="stat-card-label">em andamento</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(22,163,74,0.08)' }}>
              <svg className="w-4 h-4" style={{ color: '#16A34A' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 12l2 2 4-4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="10" strokeWidth="2"/>
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="stat-card-value" style={{ color: '#16A34A' }}>{aptoCount}</span>
              <span className="stat-card-label">score ≥70%</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(217,119,6,0.08)' }}>
              <svg className="w-4 h-4" style={{ color: '#D97706' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                <path d="M12 8v4M12 16h.01" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="stat-card-value" style={{ color: '#D97706' }}>{waitingCount}</span>
              <span className="stat-card-label">aguardando IA</span>
            </div>
          </div>
          {totalValor > 0 && (
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: 'rgba(124,58,237,0.08)' }}>
                <svg className="w-4 h-4" style={{ color: '#7C3AED' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="stat-card-value" style={{ color: '#7C3AED', fontSize: '1rem' }}>{(totalValor / 1_000_000).toFixed(0)}M</span>
                <span className="stat-card-label">pipeline total</span>
              </div>
            </div>
          )}
        </div>

        {/* Search bar (collapsible) */}
        {showSearch && (
          <div className="fade-up mt-2">
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
        {showSearch && (
          <div className="flex flex-wrap items-center gap-2 fade-up delay-100 mt-2">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">Filtrar:</span>

            {ufList.slice(0, 6).map((uf) => (
              <button
                key={uf}
                type="button"
                onClick={() => setFilterUF(filterUF === uf ? null : uf)}
                className={`text-xs px-2.5 py-0.5 rounded-full border transition-all duration-150 ${
                  filterUF === uf
                    ? 'bg-[rgba(4,126,169,0.10)] border-[rgba(4,126,169,0.40)] text-[#047EA9] font-semibold'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 bg-white'
                }`}
              >
                {uf}
              </button>
            ))}

            {([1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFilterPri(filterPri === p ? null : p)}
                className={`text-xs px-2.5 py-0.5 rounded-full border transition-all duration-150 ${
                  filterPri === p
                    ? 'bg-[rgba(217,70,239,0.10)] border-[rgba(217,70,239,0.40)] text-[#9D00C2] font-semibold'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 bg-white'
                }`}
              >
                P{p}
              </button>
            ))}

            {(filterPri != null || filterUF || search) && (
              <button
                type="button"
                onClick={() => { setFilterPri(null); setFilterUF(null); setSearch(''); }}
                className="text-xs px-2.5 py-0.5 rounded-full border border-slate-200 text-slate-400 hover:text-[#B91C1C] hover:border-[rgba(225,72,73,0.4)] hover:bg-[rgba(225,72,73,0.06)] transition-all bg-white"
              >
                ✕ limpar
              </button>
            )}
          </div>
        )}

        {/* Bulk action bar */}
        <BulkActionBar
          count={selected.size}
          busy={deleting}
          onClear={() => setSelected(new Set())}
          onDelete={askDeleteSelected}
          onBulkUpdate={performBulkUpdate}
        />
      </div>

      {/* ── Kanban board (fills remaining height) ── */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden custom-scrollbar">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 px-6 pt-4 pb-4 h-full">
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
                  reload={load}
                  onChatLink={(e) => setChatLinkTarget(e)}
                />
              );
            })}
          </div>

          {/* Drag overlay */}
          <DragOverlay>          {activeCard ? (
              <div
                className="kanban-card shadow-2xl"
                style={{
                  width: 220,
                  transform: 'rotate(3deg) scale(1.04)',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.18), 0 0 0 2px var(--x-cyan)',
                  borderColor: 'var(--x-cyan)',
                  cursor: 'grabbing',
                }}
              >
                <div className="px-3 py-2">
                  <p className="text-[12px] font-semibold text-slate-800 line-clamp-2 mb-0.5">{activeCard.orgao || '—'}</p>
                  <p className="text-[11px] text-slate-500 truncate">{activeCard.objeto || 'sem objeto'}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    {activeCard.uf && <span className="badge badge-gray text-[10px] px-1.5 py-0">{activeCard.uf}</span>}
                    <ScoreIndicator score={activeCard.score_comercial} size="sm" thresholds={{ good: 70, warning: 45 }} />
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ── Terminal / Encerrados ── */}
      {terminal.length > 0 && (
        <details className="accordion shrink-0" style={{ borderRadius: 0, border: 'none', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
          <summary className="px-6">
            <span>Encerrados <span className="ml-1.5 text-slate-400 font-normal">({terminal.length})</span></span>
            <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="accordion-body overflow-x-auto max-h-48 overflow-y-auto custom-scrollbar">
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
                  <tr key={e.edital_id} className={`group border-b border-slate-100 hover:bg-slate-50 transition-colors ${isSelected ? 'is-selected bg-slate-50' : ''}`}>
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
                    <td className="py-2.5 pr-2"><ScoreIndicator score={e.score_comercial} size="sm" thresholds={{ good: 70, warning: 45 }} /></td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => askDeleteOne(e)}
                        disabled={deleting}
                        title="Apagar edital"
                        className="text-slate-500 hover:text-[#B91C1C] opacity-0 group-hover:opacity-100 transition-opacity p-1"
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

      {/* Command Palette */}
      {cmdOpen && <CommandPalette editais={editais} onClose={() => setCmdOpen(false)} />}

      {/* Chat Link Modal */}
      {chatLinkTarget && <ChatLinkModal edital={chatLinkTarget} onClose={() => setChatLinkTarget(null)} />}

      {/* Confirm modal */}
      <ConfirmModal
        open={!!confirm}
        busy={deleting}
        title={confirm && confirm.ids.length > 1 ? `Apagar ${confirm.ids.length} editais?` : 'Apagar edital?'}
        message={
          confirm && confirm.ids.length > 1 ? (
            <>
              Esta ação removerá <strong className="text-slate-900">{confirm.ids.length}</strong> editais do pipeline.
              <br />Não poderá ser desfeita.
            </>
          ) : (
            <>
              Esta ação removerá <strong className="text-slate-900">{confirm?.label}</strong> do pipeline.
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
