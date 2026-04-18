import { backendFetch } from '@/lib/backend';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function badge(s: string) {
  if (s === 'APTO') return 'bg-green-100 text-green-800';
  if (s === 'APTO COM RESSALVAS') return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

function tryParse(s: string | null) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default async function AnaliseDetalhe({ params }: { params: { id: string } }) {
  if (process.env.REQUIRE_LOGIN === '1') {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@xertica.com')) redirect('/');
  }

  const r = await backendFetch(`/analyses/${params.id}`);
  if (r.status === 404) notFound();
  if (!r.ok) {
    return <div className="card text-red-600">Erro {r.status}: {await r.text()}</div>;
  }
  const a: any = await r.json();
  const alertas: string[] = tryParse(a.alertas_json) || [];
  const gaps: any[] = tryParse(a.gaps_json) || [];
  const trello: any = tryParse(a.campos_trello_json) || {};
  const keywords: string[] = tryParse(a.keywords_busca) || [];

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-500 uppercase">Análise</div>
            <h1 className="text-2xl font-bold">{a.orgao || '—'}</h1>
            <div className="text-sm text-slate-500">
              {a.uf || '—'} · {a.modalidade || '—'} · {new Date(a.data_analise).toLocaleString('pt-BR')}
            </div>
            {a.edital_filename && <div className="text-xs text-slate-400 mt-1">{a.edital_filename}</div>}
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold">{a.score_aderencia ?? '—'}</div>
            <span className={`badge ${badge(a.status)} mt-2`}>{a.status}</span>
          </div>
        </div>
        {a.bloqueio_camada_1 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
            <strong>Bloqueio camada 1:</strong> {a.bloqueio_camada_1}
          </div>
        )}
      </div>

      {a.objeto && (
        <div className="card">
          <h3 className="font-semibold mb-2">Objeto</h3>
          <p className="text-sm text-slate-700">{a.objeto}</p>
        </div>
      )}

      {a.estrategia && (
        <div className="card">
          <h3 className="font-semibold mb-2">Estratégia</h3>
          <p className="text-sm whitespace-pre-line text-slate-700">{a.estrategia}</p>
        </div>
      )}

      {alertas.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Alertas</h3>
          <ul className="list-disc pl-5 text-sm space-y-1 text-slate-700">
            {alertas.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Gaps ({gaps.length})</h3>
          <div className="space-y-2 text-sm">
            {gaps.map((g, i) => (
              <div key={i} className="border-l-2 border-amber-400 pl-3">
                <div className="font-medium">{g.requisito}</div>
                <div className="text-xs text-slate-500">tipo: {g.tipo}</div>
                <div className="text-xs">{g.recomendacao}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card text-xs text-slate-500 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><div className="uppercase">Evidências</div><div className="text-base text-slate-800">{a.evidencias_count ?? 0}</div></div>
        <div><div className="uppercase">Requisitos atend.</div><div className="text-base text-slate-800">{a.requisitos_atendidos_count ?? 0}</div></div>
        <div><div className="uppercase">Pipeline</div><div className="text-base text-slate-800">{a.pipeline_ms ? `${Math.round(a.pipeline_ms/1000)}s` : '—'}</div></div>
        <div><div className="uppercase">Valor estimado</div><div className="text-base text-slate-800">{a.valor_estimado ? `R$ ${Number(a.valor_estimado).toLocaleString('pt-BR')}` : '—'}</div></div>
      </div>

      {keywords.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Keywords usadas pelo Qualificador</h3>
          <div className="flex flex-wrap gap-2">
            {keywords.map((k, i) => <span key={i} className="badge bg-xertica-50 text-xertica-700">{k}</span>)}
          </div>
        </div>
      )}

      {trello?.titulo_card && (
        <div className="card">
          <h3 className="font-semibold mb-2">Card Trello sugerido</h3>
          <div className="text-sm font-medium">{trello.titulo_card}</div>
          {Array.isArray(trello.checklist) && (
            <ul className="list-disc pl-5 mt-2 text-sm space-y-1">
              {trello.checklist.map((c: string, i: number) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
