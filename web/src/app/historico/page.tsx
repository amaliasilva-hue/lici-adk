'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type Row = {
  edital_id: string;
  orgao: string;
  uf: string;
  objeto?: string;
  fase_atual: string;
  estado_terminal?: string;
  score_comercial?: number;
  vendedor_email?: string;
  numero_pregao?: string;
  criado_em?: string;
};

const STAGES: Record<string, string> = {
  identificacao: 'Identificação', analise: 'Análise', pre_disputa: 'Pré-disputa',
  proposta: 'Proposta', disputa: 'Disputa', habilitacao: 'Habilitação',
  recursos: 'Recursos', homologado: 'Homologado',
};

const FASE_OPTS = ['', ...Object.keys(STAGES)];
const UF_OPTS   = ['', 'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export default function HistoricoPage() {
  const [rows, setRows]         = useState<Row[]>([]);
  const [loading, setLoading]   = useState(true);
  const [fase, setFase]         = useState('');
  const [uf, setUf]             = useState('');
  const [vendedor, setVendedor] = useState('');
  const [limit, setLimit]       = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (fase)    params.set('fase', fase);
      if (uf)      params.set('uf', uf);
      if (vendedor) params.set('vendedor_email', vendedor);
      const r = await fetch(`/api/proxy/editais?${params}`);
      if (r.ok) setRows(await r.json());
    } finally {
      setLoading(false);
    }
  }, [fase, uf, vendedor, limit]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <h1 className="font-poppins font-bold text-2xl text-white">Histórico de editais</h1>

      {/* Filters */}
      <div className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-white/40 mb-1 block">Fase</label>
          <select value={fase} onChange={(e) => setFase(e.target.value)} className="input w-40">
            {FASE_OPTS.map((f) => (
              <option key={f} value={f}>{f ? STAGES[f] : '— todas —'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">UF</label>
          <select value={uf} onChange={(e) => setUf(e.target.value)} className="input w-28">
            {UF_OPTS.map((u) => <option key={u} value={u}>{u || '— UF —'}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Vendedor</label>
          <input
            type="email"
            placeholder="email@xertica.com"
            value={vendedor}
            onChange={(e) => setVendedor(e.target.value)}
            className="input w-52"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Limite</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="input w-24">
            {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={load} className="btn btn-primary">Filtrar</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-white/40 text-sm py-8 text-center">Carregando…</div>
      ) : rows.length === 0 ? (
        <div className="text-white/30 text-sm py-8 text-center">Nenhum edital encontrado.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-white/70">
              <thead>
                <tr className="text-left text-xs text-white/40 border-b border-white/10">
                  <th className="px-4 py-3">Órgão</th>
                  <th className="px-4 py-3">UF</th>
                  <th className="px-4 py-3">Objeto</th>
                  <th className="px-4 py-3">Fase</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.edital_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/edital/${row.edital_id}`} className="hover:text-white">
                        {row.orgao || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.uf}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{row.objeto || '—'}</td>
                    <td className="px-4 py-3">
                      {row.estado_terminal ? (
                        <span className={`badge ${row.estado_terminal === 'ganho' ? 'badge-green' : 'badge-red'}`}>
                          {row.estado_terminal}
                        </span>
                      ) : (
                        <span className="badge badge-blue">
                          {STAGES[row.fase_atual] ?? row.fase_atual}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.score_comercial != null ? (
                        <span className={`badge ${row.score_comercial >= 70 ? 'badge-green' : row.score_comercial >= 45 ? 'badge-blue' : 'badge-red'}`}>
                          {row.score_comercial}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-white/40 text-xs">
                      {row.criado_em ? new Date(row.criado_em).toLocaleDateString('pt-BR') : '—'}
                    </td>
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
