'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

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
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/proxy/editais?limit=200');
      if (r.ok) setEditais(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  function clearSelection() {
    setSelected(new Set());
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0 || deleting) return;
    setDeleting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/proxy/editais/${id}`, { method: 'DELETE' }).then((r) => {
            if (!r.ok && r.status !== 204) throw new Error(`falha ${r.status}`);
            return id;
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        alert(`Falha ao apagar ${failed} de ${ids.length} edital(is).`);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function deleteOne(edital: Edital) {
    if (!confirm(`Apagar este edital?\n\n${edital.orgao || edital.edital_id}`)) return;
    await deleteIds([edital.edital_id]);
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Apagar ${ids.length} edital(is) selecionado(s)? Esta ação não pode ser desfeita.`)) return;
    await deleteIds(ids);
  }

  const byStage = (stage: string) =>
    editais.filter((e) => e.fase_atual === stage && !e.estado_terminal);
  const terminal = editais.filter((e) => !!e.estado_terminal);

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
    <div className="space-y-6 animate-fade-in">
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

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm backdrop-blur-sm">
          <span className="text-slate-300">
            <strong className="text-white">{selected.size}</strong> selecionado{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button onClick={clearSelection} className="btn btn-ghost text-xs" disabled={deleting}>
              Limpar
            </button>
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="btn text-xs bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Apagando…' : `Apagar ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {/* Kanban */}
      <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-2.5 min-w-max">
          {STAGES.map((stage, idx) => {
            const cards   = byStage(stage.key);
            const prevStage = idx > 0 ? STAGES[idx - 1].key : null;
            const nextStage = idx < STAGES.length - 1 ? STAGES[idx + 1].key : null;
            return (
              <div key={stage.key} className="stage-col w-56">
                <div className="stage-col-title">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span>{stage.label}</span>
                  </div>
                  <span className="bg-white/[0.08] text-slate-400 rounded-full px-2 py-0.5 text-[10px] font-mono">
                    {cards.length}
                  </span>
                </div>
                {cards.map((e) => {
                  const isSelected = selected.has(e.edital_id);
                  return (
                  <div
                    key={e.edital_id}
                    className={`kanban-card group relative ${isSelected ? 'ring-2 ring-xertica-500' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(e.edital_id)}
                      aria-label="Selecionar edital"
                      className={`absolute top-2 left-2 w-3.5 h-3.5 cursor-pointer ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
                    />
                    <button
                      type="button"
                      onClick={() => deleteOne(e)}
                      disabled={deleting}
                      title="Apagar edital"
                      aria-label="Apagar edital"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-brand-red p-1 rounded"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                    <Link href={`/edital/${e.edital_id}`} className="block mb-2 pl-5">
                      <p className="text-xs font-semibold text-white leading-snug line-clamp-2 mb-0.5 group-hover:text-primary-light transition-colors">
                        {e.orgao || '—'}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">{e.objeto || 'sem objeto'}</p>
                    </Link>
                    <div className="flex items-center gap-1 flex-wrap">
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
                  <th className="pb-2 pr-4 font-normal">Órgão</th>
                  <th className="pb-2 pr-4 font-normal">UF</th>
                  <th className="pb-2 pr-4 font-normal">Objeto</th>
                  <th className="pb-2 pr-3 font-normal">Estado</th>
                  <th className="pb-2 font-normal">Score</th>
                </tr>
              </thead>
              <tbody>
                {terminal.map((e) => (
                  <tr key={e.edital_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
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
                    <td className="py-2.5"><ScoreBadge score={e.score_comercial} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

