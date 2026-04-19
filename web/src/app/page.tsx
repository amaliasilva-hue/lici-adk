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
      <div className="flex items-center justify-center h-64 text-white/40 text-sm">
        Carregando pipeline…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-poppins font-bold text-2xl text-white">Pipeline de Editais</h1>
          <p className="text-sm text-white/50 mt-0.5">{editais.length} edital(is) ativos</p>
        </div>
        <Link href="/upload" className="btn btn-primary">+ Novo edital</Link>
      </div>

      {/* Kanban */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
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


type Job = {
  analysis_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  current_agent?: string | null;
  result?: any;
  error?: string;
};

export default function Home() {
  const { data: session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setError(null);
    setJob(null);
    setBusy(true);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/proxy/analyze', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`POST /analyze ${r.status}: ${await r.text()}`);
      const created: Job = await r.json();
      setJob(created);

      while (true) {
        await new Promise((res) => setTimeout(res, 3000));
        const pr = await fetch(`/api/proxy/analyze/${created.analysis_id}`);
        if (!pr.ok) throw new Error(`GET status ${pr.status}`);
        const j: Job = await pr.json();
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') break;
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  }

  if (!session && process.env.NEXT_PUBLIC_REQUIRE_LOGIN === '1') {
    return (
      <div className="card text-center">
        <h1 className="text-2xl font-bold text-xertica-700 mb-2">lici-adk</h1>
        <p className="text-slate-600 mb-4">Análise de licitações públicas com IA agêntica.</p>
        <p className="text-sm text-slate-500">Faça login com sua conta @xertica.com para começar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-xl font-bold mb-1">Nova análise</h1>
        <p className="text-sm text-slate-500 mb-4">
          Envie o PDF do edital. O pipeline (Extrator → Qualificador → Analista → Persistor) leva
          até 4 minutos para editais de 60-100 páginas.
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            disabled={busy}
          />
          <button onClick={submit} disabled={!file || busy} className="btn btn-primary disabled:opacity-50">
            {busy ? 'Analisando…' : 'Analisar edital'}
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      </div>

      {job && (
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">analysis_id</div>
              <div className="font-mono text-sm">{job.analysis_id}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">status</div>
              <div>
                <span className={
                  job.status === 'done' ? 'badge bg-green-100 text-green-800'
                  : job.status === 'failed' ? 'badge bg-red-100 text-red-800'
                  : 'badge bg-blue-100 text-blue-800'
                }>{job.status}</span>
                {job.current_agent && <span className="ml-2 text-xs text-slate-500">agente: {job.current_agent}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">tempo</div>
              <div className="font-mono">{elapsed}s</div>
            </div>
          </div>
          {job.error && <div className="mt-3 text-sm text-red-600">Erro: {job.error}</div>}
        </div>
      )}

      {job?.result && <ParecerView parecer={job.result} />}
    </div>
  );
}
