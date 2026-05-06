"use client";

import { AuthGate } from "@/app/auth-gate";
import { api, type MapaPrecos, type ItemPreco } from "@/lib/api";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

function fmt(v?: number) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function scoreColor(score: number) {
  if (score >= 0.7) return "text-green-400";
  if (score >= 0.4) return "text-yellow-400";
  return "text-red-400";
}

export default function MapaPrecosPage() {
  const { id } = useParams<{ id: string }>();
  const [mapa, setMapa] = useState<MapaPrecos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.contratacoes
      .getMapaPrecos(id)
      .then(setMapa)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const chartData = mapa?.itens_validos
    ?.slice(0, 20)
    .map((item: ItemPreco, i: number) => ({
      name: `#${i + 1}`,
      valor: item.valor_unitario,
      score: item.score_comparabilidade,
    })) ?? [];

  return (
    <AuthGate>
      <div className="min-h-screen p-8">
        <div className="max-w-5xl mx-auto">
          <a href={`/contratacoes/${id}`} className="text-slate-400 hover:text-white text-sm">
            ← Contratação
          </a>
          <h1 className="font-display font-bold text-2xl text-white mt-4">Mapa de Preços</h1>

          {loading && <p className="mt-8 text-slate-500">Carregando…</p>}
          {error && (
            <div className="mt-4 p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {mapa && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-4 mt-6">
                {[
                  { label: "Preço Referência", value: fmt(mapa.preco_referencia) },
                  { label: "Mediana", value: fmt(mapa.preco_mediana) },
                  { label: "CV", value: mapa.coeficiente_variacao != null ? `${(mapa.coeficiente_variacao * 100).toFixed(1)}%` : "—" },
                  { label: "Itens Válidos", value: String(mapa.total_itens_validos) },
                ].map(({ label, value }) => (
                  <div key={label} className="card">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
                    <p className="font-display font-bold text-xl text-white mt-1">{value}</p>
                  </div>
                ))}
              </div>

              {/* Box-plot data */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                {[
                  { label: "Mínimo", value: fmt(mapa.preco_minimo) },
                  { label: "P25", value: fmt(mapa.preco_p25) },
                  { label: "P75", value: fmt(mapa.preco_p75) },
                ].map(({ label, value }) => (
                  <div key={label} className="card !py-3">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-sm font-medium text-slate-200 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              {chartData.length > 0 && (
                <div className="card mt-6">
                  <h2 className="font-display font-semibold text-white mb-4">
                    Distribuição de Preços (top 20 itens)
                  </h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#16293D", border: "1px solid #1E3550", borderRadius: 8 }}
                        formatter={(v: number) => [fmt(v), "Valor"]}
                      />
                      <ReferenceLine y={mapa.preco_referencia} stroke="#00BCD4" strokeDasharray="4 2" label={{ value: "Ref.", fill: "#00BCD4", fontSize: 11 }} />
                      <Bar dataKey="valor" fill="#1E5FA8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Items table */}
              <div className="card !p-0 overflow-hidden mt-6">
                <div className="px-6 py-4 border-b border-surface-border">
                  <h2 className="font-display font-semibold text-white">Itens de Preço</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-surface-border">
                        <th className="px-4 py-3 text-left">Fonte</th>
                        <th className="px-4 py-3 text-left">Descrição</th>
                        <th className="px-4 py-3 text-right">Valor Unit.</th>
                        <th className="px-4 py-3 text-right">Unidade</th>
                        <th className="px-4 py-3 text-right">Score</th>
                        <th className="px-4 py-3 text-left">Evidência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapa.itens_validos.map((item: ItemPreco, i: number) => (
                        <tr
                          key={i}
                          className="border-b border-surface-border/50 hover:bg-surface-border/20"
                        >
                          <td className="px-4 py-3 text-slate-400">{item.fonte}</td>
                          <td className="px-4 py-3 text-slate-200 max-w-xs truncate">
                            {item.descricao_licitada}
                          </td>
                          <td className="px-4 py-3 text-right text-white font-medium">
                            {fmt(item.valor_unitario)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-400">{item.unidade}</td>
                          <td className={`px-4 py-3 text-right font-medium ${scoreColor(item.score_comparabilidade)}`}>
                            {(item.score_comparabilidade * 100).toFixed(0)}
                          </td>
                          <td className="px-4 py-3">
                            {item.url_evidencia ? (
                              <a
                                href={item.url_evidencia}
                                target="_blank"
                                rel="noreferrer"
                                className="text-brand-cyan hover:underline text-xs"
                              >
                                Ver →
                              </a>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Methodology */}
              {mapa.justificativa_metodologia && (
                <div className="card mt-6">
                  <h2 className="font-display font-semibold text-white mb-2">Justificativa Metodológica</h2>
                  <p className="text-slate-300 text-sm leading-relaxed">{mapa.justificativa_metodologia}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
