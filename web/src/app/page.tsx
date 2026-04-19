'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const STAGES: { key: string; label: string }[] = [
  { key: 'identificacao', label: 'Identificação' },
  { key: 'analise',       label: 'Análise' },
  { key: 'pre_disputa',   label: 'Pré-disputa' },
  { key: 'proposta',      label: 'Proposta' },
  { key: 'disputa',       label: 'Disputa' },
  { key: 'habilitacao',   label: 'Habilitação' },
  { key: 'recursos',      label: 'Recursos' },
  { key: 'homologado',    label: 'Homologado' },
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

  const byStage = (stage: string) =>
    editais.filter((e) => e.fase_atual === stage && !e.estado_terminal);
  const terminal = editais.filter((e) => !!e.estado_terminal);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-white/40 text-sm gap-3">
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-poppins font-bold text-2xl text-white">Pipeline de Editais</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {activeCount} em andamento · {aptoCount} APTO (score ≥ 70)
          </p>
        </div>
        <Link href="/upload" className="btn btn-primary shrink-0">+ Novo edital</Link>
      </div>

      {/* Kanban */}
      <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-2.5 min-w-max">
          {STAGES.map((stage, idx) => {
            const cards   = byStage(stage.key);
            const prevStage = idx > 0 ? STAGES[idx - 1].key : null;
            const nextStage = idx < STAGES.length - 1 ? STAGES[idx + 1].key : null;
            return (
              <div key={stage.key} className="stage-col w-52">
                <div className="stage-col-title">
                  <span>{stage.label}</span>
                  {cards.length > 0 && (
                    <span className="bg-white/10 text-white/50 rounded-full px-1.5 py-0.5 text-[10px]">
                      {cards.length}
                    </span>
                  )}
                </div>
                {cards.map((e) => (
                  <div key={e.edital_id} className="kanban-card group">
                    <Link href={`/edital/${e.edital_id}`} className="block mb-2">
                      <p className="text-xs font-semibold text-white/90 leading-snug line-clamp-2 mb-0.5">
                        {e.orgao || '—'}
                      </p>
                      <p className="text-[11px] text-white/40 truncate">{e.objeto || 'sem objeto'}</p>
                    </Link>
                    <div className="flex items-center gap-1 flex-wrap">
                      {e.uf && <span className="badge badge-gray text-[10px] px-1.5 py-0">{e.uf}</span>}
                      <ScoreBadge score={e.score_comercial} />
                      <PriBadge pri={e.prioridade} />
                    </div>
                    {/* Move buttons */}
                    <div className="hidden group-hover:flex gap-1 mt-2 pt-2 border-t border-white/8">
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
                ))}
                {cards.length === 0 && (
                  <div className="text-[11px] text-white/15 text-center py-6 border border-dashed border-white/8 rounded-xl">
                    vazio
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
            <span>Encerrados <span className="ml-1.5 text-white/40 font-normal">({terminal.length})</span></span>
            <svg className="w-4 h-4 text-white/35 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="accordion-body overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-white/35 border-b border-white/8">
                  <th className="pb-2 pr-4 font-normal">Órgão</th>
                  <th className="pb-2 pr-4 font-normal">UF</th>
                  <th className="pb-2 pr-4 font-normal">Objeto</th>
                  <th className="pb-2 pr-3 font-normal">Estado</th>
                  <th className="pb-2 font-normal">Score</th>
                </tr>
              </thead>
              <tbody>
                {terminal.map((e) => (
                  <tr key={e.edital_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2.5 pr-4">
                      <Link href={`/edital/${e.edital_id}`} className="text-white/80 hover:text-white transition-colors">
                        {e.orgao}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-white/50">{e.uf}</td>
                    <td className="py-2.5 pr-4 max-w-xs truncate text-white/50">{e.objeto}</td>
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

          {STAGES.map((stage, idx) => {
            const cards = byStage(stage.key);
            const prevStage = idx > 0 ? STAGES[idx - 1].key : null;
            const nextStage = idx < STAGES.length - 1 ? STAGES[idx + 1].key : null;
            return (
              <div key={stage.key} className="stage-col">
                <div className="stage-col-title flex items-center justify-between">
                  <span>{stage.label}</span>
                  <span className="text-white/40">{cards.length}</span>
                </div>
                {cards.map((e) => (
                  <div key={e.edital_id} className="kanban-card group">
                    <Link href={`/edital/${e.edital_id}`} className="block mb-1">
                      <p className="text-sm font-medium text-white leading-snug line-clamp-2">
                        {e.orgao || '—'}
                      </p>
                      <p className="text-xs text-white/50 truncate">{e.objeto || 'sem objeto'}</p>
                    </Link>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      <span className="badge badge-gray">{e.uf}</span>
                      <ScoreBadge score={e.score_comercial} />
                      <PriBadge pri={e.prioridade} />
                    </div>
                    {/* Move buttons (visible on hover) */}
                    <div className="hidden group-hover:flex gap-1 mt-2">
                      {prevStage && (
                        <button
                          onClick={() => moveTo(e, prevStage)}
                          disabled={moving === e.edital_id}
                          className="text-[10px] btn btn-ghost px-2 py-0.5 opacity-60 hover:opacity-100"
                          title={`← ${STAGES[idx-1].label}`}
                        >
                          ←
                        </button>
                      )}
                      {nextStage && (
                        <button
                          onClick={() => moveTo(e, nextStage)}
                          disabled={moving === e.edital_id}
                          className="text-[10px] btn btn-primary px-2 py-0.5 ml-auto"
                          title={`→ ${STAGES[idx+1].label}`}
                        >
                          →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {cards.length === 0 && (
                  <div className="text-xs text-white/20 text-center py-4">vazio</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal */}
      {terminal.length > 0 && (
        <div>
          <h2 className="font-poppins font-semibold text-white/60 text-sm uppercase tracking-wider mb-3">
            Encerrados
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-white/70">
              <thead>
                <tr className="text-left text-xs text-white/40 border-b border-white/10">
                  <th className="pb-2 pr-4">Órgão</th>
                  <th className="pb-2 pr-4">UF</th>
                  <th className="pb-2 pr-4">Objeto</th>
                  <th className="pb-2 pr-4">Estado</th>
                  <th className="pb-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {terminal.map((e) => (
                  <tr key={e.edital_id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4">
                      <Link href={`/edital/${e.edital_id}`} className="hover:text-white">
                        {e.orgao}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{e.uf}</td>
                    <td className="py-2 pr-4 max-w-xs truncate">{e.objeto}</td>
                    <td className="py-2 pr-4">
                      <span className={`badge ${TERMINAL_COLORS[e.estado_terminal!] ?? 'badge-gray'}`}>
                        {e.estado_terminal}
                      </span>
                    </td>
                    <td className="py-2"><ScoreBadge score={e.score_comercial} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

