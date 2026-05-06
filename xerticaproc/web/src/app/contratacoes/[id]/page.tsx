"use client";

import { AuthGate } from "@/app/auth-gate";
import { api, pollJob, type ContratacaoSummary, type JobStatus } from "@/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const ETAPAS = [
  { key: "demanda",      label: "Estruturar Demanda",    step: 1 },
  { key: "decomposicao", label: "Decompor Objeto",        step: 2 },
  { key: "mercado",      label: "Pesquisa de Mercado",    step: 3 },
  { key: "precos",       label: "Pesquisa de Preços",     step: 4 },
  { key: "tecnico",      label: "Requisitos Técnicos",    step: 5 },
  { key: "juridico",     label: "Validação Jurídica",     step: 6 },
  { key: "riscos",       label: "Matriz de Riscos",       step: 7 },
  { key: "etp",          label: "Redigir ETP",            step: 8 },
  { key: "tr",           label: "Redigir TR",             step: 9 },
] as const;

const STATUS_COLOR: Record<string, string> = {
  rascunho:         "text-slate-400",
  em_analise:       "text-brand-cyan",
  pesquisa_mercado: "text-yellow-400",
  pesquisa_precos:  "text-yellow-400",
  revisao:          "text-blue-400",
  aprovado:         "text-green-400",
  cancelado:        "text-red-400",
};

export default function ContratacaoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contratacao, setContratacao] = useState<ContratacaoSummary | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.contratacoes.get(id).then(setContratacao).catch(console.error);
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  async function runPipeline() {
    setRunning(true);
    setError(null);
    try {
      const { job_id } = await api.contratacoes.runPipeline(id);
      await pollJob(job_id, setJob);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function runEtapa(etapa: string) {
    setRunning(true);
    setError(null);
    try {
      const { job_id } = await api.contratacoes.runEtapa(id, etapa);
      await pollJob(job_id, setJob);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const progress = job?.progresso ?? 0;

  return (
    <AuthGate>
      <div className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <a href="/" className="text-slate-400 hover:text-white text-sm">← Dashboard</a>

          {contratacao ? (
            <>
              <div className="mt-6 flex items-start justify-between">
                <div>
                  <h1 className="font-display font-bold text-2xl text-white">
                    {contratacao.objeto_resumido}
                  </h1>
                  <p className="text-slate-400 text-sm mt-1">{contratacao.nome_orgao}</p>
                  <p className={`text-sm font-medium mt-2 ${STATUS_COLOR[contratacao.status] ?? "text-slate-400"}`}>
                    {contratacao.status.replace(/_/g, " ")}
                  </p>
                </div>
                <button
                  onClick={runPipeline}
                  disabled={running}
                  className="px-5 py-2.5 bg-brand-blue hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  {running ? "Executando…" : "▶ Executar Pipeline Completo"}
                </button>
              </div>

              {/* Progress bar */}
              {running && job && (
                <div className="mt-6 card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-300">
                      {job.etapa ? `Etapa: ${job.etapa}` : "Processando…"}
                    </span>
                    <span className="text-sm text-brand-cyan">{progress}%</span>
                  </div>
                  <div className="w-full bg-surface-border rounded-full h-2">
                    <div
                      className="bg-brand-cyan h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-4 p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Etapas grid */}
              <div className="mt-8 grid grid-cols-3 gap-4">
                {ETAPAS.map(({ key, label, step }) => (
                  <div key={key} className="card flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-surface-border text-xs text-slate-400 flex items-center justify-center">
                        {step}
                      </span>
                      <span className="text-sm font-medium text-slate-200">{label}</span>
                    </div>
                    <button
                      onClick={() => runEtapa(key)}
                      disabled={running}
                      className="mt-auto text-xs text-brand-cyan hover:underline disabled:opacity-40 text-left"
                    >
                      Executar etapa →
                    </button>
                  </div>
                ))}
              </div>

              {/* Output links */}
              <div className="mt-8 card">
                <h2 className="font-display font-semibold text-white mb-4">Documentos Gerados</h2>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push(`/contratacoes/${id}/precos`)}
                    className="px-4 py-2 bg-surface-border hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition-colors"
                  >
                    📊 Mapa de Preços
                  </button>
                  <button
                    onClick={() => router.push(`/contratacoes/${id}/etp`)}
                    className="px-4 py-2 bg-surface-border hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition-colors"
                  >
                    📄 ETP
                  </button>
                  <button
                    onClick={() => router.push(`/contratacoes/${id}/tr`)}
                    className="px-4 py-2 bg-surface-border hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition-colors"
                  >
                    📋 Termo de Referência
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-16 text-center text-slate-500">Carregando…</div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
