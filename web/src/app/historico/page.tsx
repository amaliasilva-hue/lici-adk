'use client';
import { useEffect, useState, useCallback } from 'react';
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

function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return <span className="text-slate-300">—</span>;
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
  const filtered = editais.filter(e => {
    if (orgaoFilter && !e.orgao?.toLowerCase().includes(orgaoFilter.toLowerCase())) return false;
    if (statusFilter) {
      // status is stored in result_status field (or via score heuristic)
      const s = e.result_status ?? '';
      if (!s.toLowerCase().includes(statusFilter.toLowerCase())) return false;
    }
    if (scoreMin && (e.score_comercial ?? 0) < Number(scoreMin)) return false;
    return true;
  });

  // Sort by criado_em desc
  const sorted = [...filtered].sort((a, b) => {
    const da = a.criado_em ? new Date(a.criado_em).getTime() : 0;
    const db = b.criado_em ? new Date(b.criado_em).getTime() : 0;
    return db - da;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-poppins font-bold text-2xl text-slate-900">Histórico de Editais</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {loading ? 'Carregando…' : `${sorted.length} registros`}
          </p>
        </div>
        <Link href="/upload" className="btn btn-primary shrink-0">+ Novo edital</Link>
      </div>

      {/* Filters */}
      <div className="card">
        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Órgão</label>
            <input
              type="text"
              value={orgaoFilter}
              onChange={e => setOrgaoFilter(e.target.value)}
              placeholder="Ex: PRODESP"
              className="input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">UF</label>
            <select value={ufFilter} onChange={e => setUfFilter(e.target.value)} className="input w-full">
              {UF_LIST.map(u => <option key={u} value={u}>{u || '— todas —'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-full">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || '— todos —'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Score mín.</label>
            <input
              type="number"
              min={0} max={100}
              value={scoreMin}
              onChange={e => setScoreMin(e.target.value)}
              placeholder="0"
              className="input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Vendedor</label>
            <input
              type="text"
              value={vendedorFilter}
              onChange={e => setVendedorFilter(e.target.value)}
              placeholder="email@xertica.com"
              className="input w-full"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
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
              {loading && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-300 text-sm">Carregando…</td>
                </tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-200 text-sm">Nenhum edital encontrado com esses filtros.</td>
                </tr>
              )}
              {sorted.map(e => (
                <tr key={e.edital_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4">
                    <Link href={`/edital/${e.edital_id}`} className="text-slate-700 hover:text-slate-900 transition-colors font-medium truncate block max-w-[160px]">
                      {e.orgao || '—'}
                    </Link>
                    {e.numero_pregao && <p className="text-[11px] text-slate-300">{e.numero_pregao}</p>}
                  </td>
                  <td className="py-3 px-3 text-slate-400">{e.uf}</td>
                  <td className="py-3 px-3 hidden md:table-cell">
                    <p className="text-slate-500 text-xs max-w-xs truncate">{e.objeto || '—'}</p>
                    {e.portal && <p className="text-[11px] text-slate-300">{e.portal}</p>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="badge badge-gray text-[10px]">
                      {STAGE_LABELS[e.fase_atual] ?? e.fase_atual}
                    </span>
                  </td>
                  <td className="py-3 px-3 hidden sm:table-cell">
                    {e.estado_terminal ? (
                      <span className={`badge ${e.estado_terminal === 'ganho' ? 'badge-green' : 'badge-red'}`}>
                        {e.estado_terminal}
                      </span>
                    ) : (
                      <span className="text-slate-200 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <ScoreBadge score={e.score_comercial} />
                  </td>
                  <td className="py-3 px-3 hidden lg:table-cell text-slate-300 text-xs">
                    {e.criado_em ? new Date(e.criado_em).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/edital/${e.edital_id}`} className="btn btn-ghost btn-sm">
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
