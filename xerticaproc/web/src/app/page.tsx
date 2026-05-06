"use client";

import { AuthGate } from "./auth-gate";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type ContratacaoSummary } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  em_analise: "Em análise",
  pesquisa_mercado: "Pesquisa de mercado",
  pesquisa_precos: "Pesquisa de preços",
  revisao: "Revisão",
  aprovado: "Aprovado",
  cancelado: "Cancelado",
};

const STATUS_BADGE: Record<string, string> = {
  rascunho: "badge-gray",
  em_analise: "badge-blue",
  pesquisa_mercado: "badge-yellow",
  pesquisa_precos: "badge-yellow",
  revisao: "badge-blue",
  aprovado: "badge-green",
  cancelado: "badge-red",
};

export default function DashboardPage() {
  const [contratacoes, setContratacoes] = useState<ContratacaoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.contratacoes
      .list()
      .then(setContratacoes)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthGate>
      <div className="min-h-screen">
        {/* Sidebar */}
        <aside className="fixed inset-y-0 left-0 w-64 bg-surface-card border-r border-surface-border flex flex-col">
          <div className="p-6 border-b border-surface-border">
            <span className="font-display font-bold text-xl text-brand-cyan">
              xertica
            </span>
            <span className="font-display text-xl text-slate-300">proc</span>
          </div>
          <nav className="flex-1 p-4 space-y-1">
            {[
              { href: "/", label: "Dashboard" },
              { href: "/contratacoes", label: "Contratações" },
              { href: "/contratacoes/nova", label: "+ Nova Contratação" },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-surface-border hover:text-white transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="ml-64 p-8">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="font-display font-bold text-2xl text-white">
                  Dashboard
                </h1>
                <p className="text-slate-400 text-sm mt-1">
                  Contratações públicas conforme Lei 14.133/2021
                </p>
              </div>
              <Link
                href="/contratacoes/nova"
                className="px-4 py-2 bg-brand-blue hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Nova Contratação
              </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[
                {
                  label: "Total",
                  value: contratacoes.length,
                  color: "text-white",
                },
                {
                  label: "Em andamento",
                  value: contratacoes.filter(
                    (c) =>
                      !["aprovado", "cancelado", "rascunho"].includes(c.status)
                  ).length,
                  color: "text-brand-cyan",
                },
                {
                  label: "Aprovadas",
                  value: contratacoes.filter((c) => c.status === "aprovado")
                    .length,
                  color: "text-brand-green",
                },
                {
                  label: "Rascunhos",
                  value: contratacoes.filter((c) => c.status === "rascunho")
                    .length,
                  color: "text-slate-400",
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="card">
                  <p className="text-slate-400 text-xs uppercase tracking-wide">
                    {label}
                  </p>
                  <p className={`font-display font-bold text-3xl mt-2 ${color}`}>
                    {loading ? "—" : value}
                  </p>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="card !p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-surface-border">
                <h2 className="font-display font-semibold text-base text-white">
                  Últimas Contratações
                </h2>
              </div>
              {error && (
                <div className="px-6 py-4 text-red-400 text-sm">{error}</div>
              )}
              {!error && (
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-surface-border">
                      <th className="px-6 py-3 text-left">Objeto</th>
                      <th className="px-6 py-3 text-left">Órgão</th>
                      <th className="px-6 py-3 text-left">Status</th>
                      <th className="px-6 py-3 text-left">Criado em</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                          Carregando…
                        </td>
                      </tr>
                    )}
                    {!loading && contratacoes.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                          Nenhuma contratação encontrada.{" "}
                          <Link href="/contratacoes/nova" className="text-brand-cyan hover:underline">
                            Criar a primeira
                          </Link>
                        </td>
                      </tr>
                    )}
                    {contratacoes.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-surface-border/50 hover:bg-surface-border/20 transition-colors"
                      >
                        <td className="px-6 py-4 text-sm text-slate-200 max-w-xs truncate">
                          {c.objeto_resumido}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">
                          {c.nome_orgao}
                        </td>
                        <td className="px-6 py-4">
                          <span className={STATUS_BADGE[c.status] ?? "badge-gray"}>
                            {STATUS_LABELS[c.status] ?? c.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">
                          {new Date(c.criado_em).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/contratacoes/${c.id}`}
                            className="text-brand-cyan hover:underline text-sm"
                          >
                            Abrir →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </main>
      </div>
    </AuthGate>
  );
}
