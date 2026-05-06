'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import ScoreIndicator from '@/components/ui/ScoreIndicator';
import EmptyState from '@/components/ui/EmptyState';
import { getJobs, updateJob, pruneOldJobs, removeJob, JOBS_KEY, type AnalysisJob } from '@/lib/analysis-store';

const AGENT_LABELS: Record<string, string> = {
  extrator:    'Extraindo dados do edital',
  qualificador:'Qualificando no BigQuery',
  analista:    'Analisando aderência',
};

const UF_LIST = ['','AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const STATUS_OPTIONS = ['', 'APTO', 'APTO COM RESSALVAS', 'INAPTO', 'NO-GO'];

const STAGE_LABELS: Record<string, string> = {
  identificacao: 'Identificação', analise: 'Análise', pre_disputa: 'Pré-disputa',
  proposta: 'Proposta', disputa: 'Disputa', habilitacao: 'Habilitação',
  recursos: 'Recursos', homologado: 'Homologado',
};

type Edital = {
  edital_id: string;
  orgao: string;
  uf: string;
  objeto?: string;
  fase_atual: string;
  estado_terminal?: string;
  score_comercial?: number;
  result_status?: string;
  criado_em?: string;
  data_encerramento?: string;
  vendedor_email?: string;
  portal?: string;
  numero_pregao?: string;
};

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100">
      {[160, 40, 220, 80, 70, 50, 70, 40].map((w, i) => (
        <td key={i} className="py-3 px-4">
          <div className="skeleton h-3 rounded-full" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}



export default function HistoricoPage() {
  const [editais, setEditais] = useState<Edital[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingJobs, setPendingJobs] = useState<AnalysisJob[]>([]);
  const [tick, setTick] = useState(0);
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<{ fileName: string; pgEditalId: string | null } | null>(null);

  // Filters
  const [orgaoFilter, setOrgaoFilter]     = useState('');
  const [ufFilter, setUfFilter]           = useState('');
  const [statusFilter, setStatusFilter]   = useState('');
  const [scoreMin, setScoreMin]           = useState('');
  const [vendedorFilter, setVendedorFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (ufFilter) params.set('uf', ufFilter);
      if (vendedorFilter) params.set('vendedor_email', vendedorFilter);
      const r = await fetch(`/api/proxy/editais?${params}`);
      if (r.ok) setEditais(await r.json());
    } finally {
      setLoading(false);
    }
  }, [ufFilter, vendedorFilter]);

  useEffect(() => { load(); }, [load]);

  // Tick every second for elapsed-time display
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Sync pending jobs from localStorage + poll them
  useEffect(() => {
    pruneOldJobs();
    setPendingJobs(getJobs());

    // Listen for cross-tab storage changes
    const onStorage = (e: StorageEvent) => {
      if (e.key === JOBS_KEY) setPendingJobs(getJobs());
    };
    window.addEventListener('storage', onStorage);

    const interval = setInterval(async () => {
      const active = getJobs().filter(j => j.status !== 'done' && j.status !== 'failed');
      if (active.length === 0) return;
      setChecking(true);
      let anyDone = false;
      let completedJob: AnalysisJob | null = null;
      await Promise.allSettled(active.map(async (job) => {
        try {
          const r = await fetch(`/api/proxy/analyze/${job.id}`);
          if (!r.ok) return;
          const data = await r.json();
          if (data.status === 'running') {
            updateJob(job.id, { status: 'running', currentAgent: data.current_agent ?? null });
          } else if (data.status === 'queued') {
            updateJob(job.id, { status: 'queued', currentAgent: null });
          } else if (data.status === 'failed') {
            updateJob(job.id, { status: 'failed', errorMsg: data.error ?? 'Falha no pipeline' });
            anyDone = true;
          } else {
            updateJob(job.id, { status: 'done', pgEditalId: data.pg_edital_id || data.edital_id || null });
            completedJob = { ...job, pgEditalId: data.pg_edital_id || data.edital_id || null;
            anyDone = true;
          }
        } catch {}
      }));
      setTimeout(() => setChecking(false), 700);
      setPendingJobs(getJobs());
      if (completedJob) setToast({ fileName: (completedJob as AnalysisJob).fileName, pgEditalId: (completedJob as AnalysisJob).pgEditalId ?? null });
      if (anyDone) load();
    }, 3000);

    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, [load]);

  // Client-side filters
  const filtered = useMemo(() => editais.filter(e => {
    if (orgaoFilter && !e.orgao?.toLowerCase().includes(orgaoFilter.toLowerCase())) return false;
    if (statusFilter) {
      const s = e.result_status ?? '';
      if (!s.toLowerCase().includes(statusFilter.toLowerCase())) return false;
    }
    if (scoreMin && (e.score_comercial ?? 0) < Number(scoreMin)) return false;
    return true;
  }), [editais, orgaoFilter, statusFilter, scoreMin]);

  // Sort by criado_em desc
  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const da = a.criado_em ? new Date(a.criado_em).getTime() : 0;
      const db = b.criado_em ? new Date(b.criado_em).getTime() : 0;
      return db - da;
    }), [filtered]);

  // CSV export
  function exportCSV() {
    const header = ['edital_id','orgao','uf','objeto','fase_atual','estado_terminal','score_comercial','portal','numero_pregao','vendedor_email','criado_em'];
    const rows = sorted.map(e => header.map(k => {
      const v = (e as any)[k];
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    }).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico-editais-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 anim-fade">
      {/* Completion toast */}
      {toast && (
        <div
          className="anim-toast fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg"
          style={{ background: '#0F172A', border: '1px solid rgba(74,222,128,0.4)', minWidth: 260, maxWidth: 360 }}
        >
          <span className="text-green-400 text-lg">✓</span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Análise concluída</p>
            <p className="text-slate-400 text-xs truncate">{toast.fileName}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {toast.pgEditalId && (
              <Link href={`/edital/${toast.pgEditalId}`} className="text-xs text-[var(--x-cyan)] hover:underline">Ver →</Link>
            )}
            <button onClick={() => setToast(null)} className="text-slate-500 hover:text-white text-lg leading-none">×</button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="heading-lg mb-1">Histórico de Editais</h1>
          <p className="text-sm text-slate-400">
            {loading ? (
              <span className="inline-block w-20 h-3 skeleton rounded-full" />
            ) : `${sorted.length} registros`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!loading && sorted.length > 0 && (
            <button onClick={exportCSV} className="btn btn-ghost text-xs gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              </svg>
              Exportar CSV
            </button>
          )}
          <Link href="/upload" className="btn btn-primary shrink-0">+ Novo edital</Link>
        </div>
      </div>

      {/* In-progress jobs panel */}
      {pendingJobs.some(j => j.status !== 'done') && (
        <div className="card space-y-3" style={{ borderColor: 'rgba(0,190,255,0.2)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Em andamento</p>
            {checking && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{
                background: 'rgba(0,190,255,0.08)',
                color: 'var(--x-cyan)',
                border: '1px solid rgba(0,190,255,0.2)',
              }}>verificando…</span>
            )}
          </div>
          {pendingJobs.filter(j => j.status !== 'done').map(job => {
            const elapsed = Math.floor((Date.now() - job.startedAt) / 1000);
            const fmtTime = elapsed >= 60 ? `${Math.floor(elapsed/60)}min ${elapsed%60}s` : `${elapsed}s`;
            const isFailed = job.status === 'failed';
            const agent = job.currentAgent ?? null;
            const isDoneExt = !!agent && agent !== 'extrator';
            const isDoneQual = agent === 'analista' || agent === 'persistor';
            const isActiveExt = !agent || agent === 'extrator';
            const isActiveQual = agent === 'qualificador';
            const isActiveAna = agent === 'analista';
            return (
              <div key={job.id} className="rounded-xl p-3 space-y-2.5" style={{
                background: isFailed ? 'rgba(225,72,73,0.06)' : 'rgba(0,190,255,0.04)',
                border: `1px solid ${isFailed ? 'rgba(225,72,73,0.2)' : 'rgba(0,190,255,0.15)'}`,
              }}>
                <div className="flex items-center gap-3">
                  {isFailed ? (
                    <span className="text-[#E14849] text-base flex-shrink-0">⚠️</span>
                  ) : (
                    <svg className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: 'var(--x-cyan)' }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{job.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {isFailed
                        ? (job.errorMsg ?? 'Falha no pipeline')
                        : `${AGENT_LABELS[agent ?? ''] ?? 'Aguardando na fila'} · ${fmtTime}`}
                    </p>
                  </div>
                  {isFailed && (
                    <button
                      onClick={() => { removeJob(job.id); setPendingJobs(getJobs()); }}
                      className="text-xs text-slate-500 hover:text-[#E14849] transition-colors flex-shrink-0 px-2 py-1"
                    >
                      Dispensar
                    </button>
                  )}
                </div>
                {!isFailed && (
                  <div className="flex gap-1.5">
                    {(['Extração', 'Qualificação', 'Análise'] as const).map((label, i) => {
                      const done = i === 0 ? isDoneExt : i === 1 ? isDoneQual : false;
                      const active = i === 0 ? isActiveExt : i === 1 ? isActiveQual : isActiveAna;
                      return (
                        <div key={label} className="flex-1 space-y-1">
                          <div className={`h-1 rounded-full transition-all duration-500 ${
                            done ? 'bg-green-500' : active ? 'bg-[var(--x-cyan)] anim-bar-pulse' : 'bg-slate-800'
                          }`} />
                          <p className={`text-[10px] text-center font-medium ${
                            active ? 'text-[var(--x-cyan)]' : done ? 'text-green-400' : 'text-slate-600'
                          }`}>{label}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Órgão</label>
            <input type="text" value={orgaoFilter} onChange={e => setOrgaoFilter(e.target.value)} placeholder="Ex: PRODESP" className="input w-full" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">UF</label>
            <select value={ufFilter} onChange={e => setUfFilter(e.target.value)} className="input w-full">
              {UF_LIST.map(u => <option key={u} value={u}>{u || '— todas —'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-full">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || '— todos —'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Score mín.</label>
            <input type="number" min={0} max={100} value={scoreMin} onChange={e => setScoreMin(e.target.value)} placeholder="0" className="input w-full" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Vendedor</label>
            <input type="text" value={vendedorFilter} onChange={e => setVendedorFilter(e.target.value)} placeholder="email@xertica.com" className="input w-full" />
          </div>
        </div>
        {(orgaoFilter || ufFilter || statusFilter || scoreMin || vendedorFilter) && !loading && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-400">{sorted.length} de {editais.length} exibidos</span>
            <button
              onClick={() => { setOrgaoFilter(''); setUfFilter(''); setStatusFilter(''); setScoreMin(''); setVendedorFilter(''); }}
              className="text-xs text-slate-400 hover:text-[#B91C1C] transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-3 px-4 font-normal">Órgão</th>
                <th className="py-3 px-3 font-normal">UF</th>
                <th className="py-3 px-3 font-normal hidden md:table-cell">Objeto</th>
                <th className="py-3 px-3 font-normal">Stage</th>
                <th className="py-3 px-3 font-normal hidden sm:table-cell">Estado</th>
                <th className="py-3 px-3 font-normal">Score</th>
                <th className="py-3 px-3 font-normal hidden lg:table-cell">Data</th>
                <th className="py-3 px-4 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8">
                    <EmptyState
                      title="Nenhum edital encontrado"
                      description="Ajuste os filtros ou importe um novo edital."
                      compact
                    />
                  </td>
                </tr>
              )}
              {!loading && sorted.map(e => (
                <tr key={e.edital_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors group">
                  <td className="py-3 px-4">
                    <Link href={`/edital/${e.edital_id}`} className="text-slate-700 group-hover:text-slate-800 transition-colors font-medium truncate block max-w-[160px]">
                      {e.orgao || '—'}
                    </Link>
                    {e.numero_pregao && <p className="text-[11px] text-slate-400">{e.numero_pregao}</p>}
                  </td>
                  <td className="py-3 px-3 text-slate-400">{e.uf}</td>
                  <td className="py-3 px-3 hidden md:table-cell">
                    <p className="text-slate-500 text-xs max-w-xs truncate">{e.objeto || '—'}</p>
                    {e.portal && <p className="text-[11px] text-slate-300">{e.portal}</p>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="badge badge-gray text-[10px]">{STAGE_LABELS[e.fase_atual] ?? e.fase_atual}</span>
                  </td>
                  <td className="py-3 px-3 hidden sm:table-cell">
                    {e.estado_terminal ? (
                      <Badge variant={e.estado_terminal === 'ganho' ? 'success' : 'danger'}>
                        {e.estado_terminal}
                      </Badge>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {e.score_comercial != null
                      ? <ScoreIndicator score={e.score_comercial} size="sm" thresholds={{ good: 70, warning: 45 }} />
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="py-3 px-3 hidden lg:table-cell text-slate-400 text-xs">
                    {e.criado_em ? new Date(e.criado_em).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/edital/${e.edital_id}`} className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity">
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
