'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';

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

function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return <span className="text-slate-400">—</span>;
  const cls = score >= 70 ? 'badge-green' : score >= 45 ? 'badge-blue' : 'badge-red';
  return <span className={`badge ${cls}`}>{score}%</span>;
}

export default function HistoricoPage() {
  const [editais, setEditais] = useState<Edital[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="space-y-6">
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
          <table className="w-full text-sm">
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
                  <td colSpan={8} className="py-12 text-center text-slate-300 text-sm">
                    Nenhum edital encontrado.
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
                      <span className={`badge ${e.estado_terminal === 'ganho' ? 'badge-green' : 'badge-red'}`}>
                        {e.estado_terminal}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <ScoreBadge score={e.score_comercial} />
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
