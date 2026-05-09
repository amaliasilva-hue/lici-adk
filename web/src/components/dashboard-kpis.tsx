'use client';
import { useEffect, useState } from 'react';

type Kpis = {
  total_editais: number;
  ultimos_7d: number;
  ultimos_30d: number;
  pipeline_valor: number;
  ganhos_30d: number;
  perdidos_30d: number;
  win_rate_30d: number;
  recomendados_go: number;
  recomendados_nogo: number;
  em_andamento: number;
  tempo_medio_analise_h: number;
  top_orgaos: { orgao: string; qtd: number; valor: number }[];
  por_fase: Record<string, number>;
};

function fmtMoeda(v: number): string {
  if (!v || v < 1) return 'R$ 0';
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

export default function DashboardKpis() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/proxy/dashboard/kpis', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!cancel) setKpis(data);
      } catch (e: any) {
        if (!cancel) setError(e.message || 'Erro ao carregar KPIs');
      }
    })();
    return () => { cancel = true; };
  }, []);

  if (error) {
    return (
      <div className="text-xs text-slate-500 px-1 py-1">KPIs indisponíveis: {error}</div>
    );
  }
  if (!kpis) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi-card-skeleton" />
        ))}
        <style jsx>{`
          .kpi-card-skeleton {
            height: 84px;
            border-radius: 12px;
            background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
            background-size: 200% 100%;
            animation: shimmer 1.4s infinite;
          }
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    );
  }

  const cards = [
    {
      label: 'Pipeline ativo',
      value: fmtMoeda(kpis.pipeline_valor),
      sub: `${kpis.em_andamento} editais`,
      color: '#047EA9',
      bg: 'rgba(4,126,169,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 14l3-3 4 4 6-6" />
        </svg>
      ),
    },
    {
      label: 'Win rate (30d)',
      value: `${kpis.win_rate_30d.toFixed(0)}%`,
      sub: `${kpis.ganhos_30d}V × ${kpis.perdidos_30d}D`,
      color: kpis.win_rate_30d >= 50 ? '#16A34A' : '#D97706',
      bg: kpis.win_rate_30d >= 50 ? 'rgba(22,163,74,0.08)' : 'rgba(217,119,6,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 5L21 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1z"/>
        </svg>
      ),
    },
    {
      label: 'Novos (7d)',
      value: kpis.ultimos_7d.toString(),
      sub: `${kpis.ultimos_30d} no mês`,
      color: '#047EA9',
      bg: 'rgba(0,190,255,0.10)',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
      ),
    },
    {
      label: 'Recomendação IA',
      value: `${kpis.recomendados_go}`,
      sub: `Go × ${kpis.recomendados_nogo} No-Go`,
      color: '#16A34A',
      bg: 'rgba(22,163,74,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      ),
    },
    {
      label: 'Tempo médio análise',
      value: kpis.tempo_medio_analise_h > 0 ? `${kpis.tempo_medio_analise_h.toFixed(1)}h` : '—',
      sub: 'últimos 30d',
      color: '#475569',
      bg: 'rgba(71,85,105,0.08)',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 transition-all hover:shadow-md hover:-translate-y-0.5"
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: c.bg, color: c.color }}
            >
              {c.icon}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                {c.label}
              </span>
              <span className="text-xl font-bold leading-tight" style={{ color: c.color }}>
                {c.value}
              </span>
              <span className="text-[11px] text-slate-500 truncate">{c.sub}</span>
            </div>
          </div>
        ))}
      </div>
      {kpis.top_orgaos.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600 px-1 overflow-x-auto">
          <span className="font-semibold text-slate-700 shrink-0">Top órgãos:</span>
          {kpis.top_orgaos.map((o) => (
            <span
              key={o.orgao}
              className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 shrink-0"
            >
              <span className="font-medium text-slate-800 truncate max-w-[160px]">{o.orgao}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-600">{o.qtd}</span>
              {o.valor > 0 && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-600">{fmtMoeda(o.valor)}</span>
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
