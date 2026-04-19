'use client';
import { useEffect, useState } from 'react';

type HealthData = {
  status: string;
  jobs_in_memory: number;
};

type Stat = {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
};

export default function AdminPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [editais, setEditais] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/proxy/health').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/proxy/editais?limit=200').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([h, e]) => {
        setHealth(h);
        setEditais(Array.isArray(e) ? e : []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Compute stats
  const total = editais.length;
  const byStage = editais.reduce((acc: Record<string, number>, e: any) => {
    acc[e.fase_atual] = (acc[e.fase_atual] ?? 0) + 1;
    return acc;
  }, {});
  const scored = editais.filter((e: any) => e.score_comercial != null);
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum: number, e: any) => sum + e.score_comercial, 0) / scored.length)
      : null;
  const apto = editais.filter((e: any) => (e.score_comercial ?? 0) >= 70).length;
  const ganhos = editais.filter((e: any) => e.estado_terminal === 'ganho').length;
  const perdidos = editais.filter((e: any) => e.estado_terminal === 'perdido').length;

  const stats: Stat[] = [
    { label: 'Editais ativos', value: total },
    { label: 'Score médio', value: avgScore != null ? `${avgScore}%` : '—' },
    { label: 'APTO (≥70%)', value: apto, sub: total ? `${Math.round((apto / total) * 100)}% do total` : '—' },
    { label: 'Ganhos', value: ganhos, color: 'text-green-accent' },
    { label: 'Perdidos', value: perdidos, color: 'text-danger' },
    { label: 'Jobs em memória', value: health?.jobs_in_memory ?? '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-poppins font-bold text-2xl text-white">Painel Administrativo</h1>
        <span className={`badge ${health?.status === 'ok' ? 'badge-green' : 'badge-red'}`}>
          {health ? `backend: ${health.status}` : 'verificando…'}
        </span>
      </div>

      {loading ? (
        <div className="text-white/40 text-sm py-8 text-center">Carregando métricas…</div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="card text-center space-y-1">
                <div className={`font-poppins font-bold text-3xl ${s.color ?? 'text-white'}`}>
                  {s.value}
                </div>
                <div className="text-xs text-white/50">{s.label}</div>
                {s.sub && <div className="text-xs text-white/30">{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Stage breakdown */}
          <div className="card">
            <h2 className="font-semibold text-white/70 mb-4 text-sm">Distribuição por fase</h2>
            <div className="space-y-2">
              {Object.entries(byStage)
                .sort((a, b) => b[1] - a[1])
                .map(([stage, count]) => (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="w-32 text-xs text-white/50 capitalize">{stage.replace('_', ' ')}</span>
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: total ? `${(count / total) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs text-white/60">{count}</span>
                  </div>
                ))}
              {Object.keys(byStage).length === 0 && (
                <p className="text-white/30 text-sm">Nenhum edital ativo.</p>
              )}
            </div>
          </div>

          {/* Health endpoint info */}
          <div className="card text-xs text-white/30 space-y-1">
            <p>Backend: {process.env.NEXT_PUBLIC_BACKEND_URL ?? '(BACKEND_URL via proxy)'}</p>
            <p>Editais carregados: {editais.length}</p>
          </div>
        </>
      )}
    </div>
  );
}
