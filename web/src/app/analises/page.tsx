import Link from 'next/link';
import { backendFetch } from '@/lib/backend';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Row = {
  analysis_id: string;
  data_analise: string;
  orgao: string | null;
  uf: string | null;
  modalidade: string | null;
  status: string;
  score_aderencia: number | null;
  evidencias_count: number | null;
  pipeline_ms: number | null;
  edital_filename: string | null;
};

function badge(s: string) {
  if (s === 'APTO') return 'badge badge-green';
  if (s === 'APTO COM RESSALVAS') return 'badge badge-orange';
  return 'badge badge-red';
}

export default async function AnalisesPage({ searchParams }: { searchParams: { orgao?: string; status?: string; uf?: string } }) {
  if (process.env.REQUIRE_LOGIN === '1') {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@xertica.com')) redirect('/');
  }

  const qs = new URLSearchParams();
  if (searchParams.orgao) qs.set('orgao', searchParams.orgao);
  if (searchParams.status) qs.set('status', searchParams.status);
  if (searchParams.uf) qs.set('uf', searchParams.uf);
  qs.set('limit', '50');

  let rows: Row[] = [];
  let error: string | null = null;
  try {
    const r = await backendFetch(`/analyses?${qs.toString()}`);
    if (!r.ok) throw new Error(`backend ${r.status}`);
    rows = await r.json();
  } catch (e: any) {
    error = e.message || String(e);
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <h1 className="text-xl font-poppins font-bold mb-3 text-white">Histórico de análises</h1>
        <form className="flex flex-wrap gap-2 text-sm">
          <input name="orgao" defaultValue={searchParams.orgao} placeholder="Órgão"
            className="input w-auto" />
          <select name="status" defaultValue={searchParams.status || ''}
            className="input w-auto">
            <option value="">Status…</option>
            <option>APTO</option>
            <option>APTO COM RESSALVAS</option>
            <option>INAPTO</option>
            <option>NO-GO</option>
          </select>
          <input name="uf" defaultValue={searchParams.uf} placeholder="UF" maxLength={2}
            className="input w-20 uppercase" />
          <button className="btn btn-primary text-sm">Filtrar</button>
        </form>
      </div>

      {error && <div className="card text-red-600 text-sm">Erro: {error}</div>}

      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-3">Data</th>
              <th className="py-2 pr-3">Órgão</th>
              <th className="py-2 pr-3">UF</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Score</th>
              <th className="py-2 pr-3 text-right">Evid.</th>
              <th className="py-2 pr-3 text-right">Tempo</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.analysis_id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 text-xs text-slate-500">{new Date(r.data_analise).toLocaleString('pt-BR')}</td>
                <td className="py-2 pr-3">{r.orgao || '—'}</td>
                <td className="py-2 pr-3">{r.uf || '—'}</td>
                <td className="py-2 pr-3"><span className={`badge ${badge(r.status)}`}>{r.status}</span></td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.score_aderencia ?? '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.evidencias_count ?? '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.pipeline_ms ? `${Math.round(r.pipeline_ms / 1000)}s` : '—'}</td>
                <td className="py-2"><Link href={`/analises/${r.analysis_id}`} className="text-xertica-600 hover:underline">abrir →</Link></td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={8} className="py-6 text-center text-slate-400">Nenhuma análise encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
