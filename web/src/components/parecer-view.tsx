"use client";

import { useMemo, useState } from "react";

type Contribuinte = {
  fonte: "atestado" | "contrato" | "drive_pdf";
  fonte_id?: string | null;
  rotulo: string;
  valor?: number | null;
  unidade?: string | null;
  moeda_original?: string | null;
  valor_original?: number | null;
  link?: string | null;
};

type Nivel = {
  nivel: "nacional" | "internacional" | "captacao";
  status: "atende" | "parcial" | "nao_atende";
  valor_acumulado: number;
  unidade?: string | null;
  delta?: number | null;
  contribuintes: Contribuinte[];
  observacao?: string | null;
};

type EquivalenciaPE = {
  motivo: string;
  pergunta_sugerida: string;
  pe_score: number;
  impacto_se_aceito: string;
};

type RequisitoCascata = {
  requisito: string;
  minimo_exigido: number;
  unidade: string;
  niveis: Nivel[];
  status_consolidado: "atende" | "parcial" | "nao_atende";
  nivel_que_satisfaz?: "nacional" | "internacional" | "captacao" | "nenhum" | null;
  equivalencia_pe?: EquivalenciaPE | null;
};

type Cenario = {
  nome: "conservador" | "otimista";
  score_aderencia: number | null;
  status: string;
  requisitos_atendidos_count: number;
  requisitos_total: number;
  descricao: string;
};

type Parecer = {
  score_aderencia: number | null;
  status: string;
  bloqueio_camada_1: string | null;
  estrategia: string;
  alertas: string[];
  requisitos_atendidos: { requisito: string; comprovacao: string; fonte: string; link?: string | null }[];
  evidencias_por_requisito: {
    requisito: string;
    texto_edital?: string | null;
    fonte_tabela: string;
    fonte_id?: string | null;
    trecho_literal: string;
    tipo_evidencia: string;
    confianca: number;
    atestado_nome?: string | null;
    atestado_resumo?: string | null;
    atestado_link?: string | null;
    valor_comprovado?: number | null;
    unidade_valor?: string | null;
  }[];
  gaps: { requisito: string; tipo: string; delta_numerico?: number | null; recomendacao: string }[];
  requisitos_cascata?: RequisitoCascata[];
  cenarios?: Cenario[];
  campos_trello?: any;
  edital_orgao?: string | null;
  edital_modalidade?: string | null;
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    APTO: "bg-green-100 text-green-800",
    "APTO COM RESSALVAS": "bg-amber-100 text-amber-800",
    INAPTO: "bg-red-100 text-red-800",
    "NO-GO": "bg-red-200 text-red-900",
  };
  return map[status] || "bg-slate-100 text-slate-800";
}

function fmtValor(v: number | null | undefined, unidade?: string | null): string {
  if (v == null) return "—";
  if (unidade === "BRL") {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }
  const num = v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return unidade ? `${num} ${unidade}` : num;
}

function nivelLabel(n: Nivel["nivel"]): string {
  return n === "nacional" ? "Nacional" : n === "internacional" ? "+ Internacionais" : "+ Captação";
}

function nivelStatusColor(s: Nivel["status"]): string {
  return s === "atende"
    ? "border-green-400 bg-green-50"
    : s === "parcial"
    ? "border-amber-400 bg-amber-50"
    : "border-red-300 bg-red-50";
}

function nivelStatusIcon(s: Nivel["status"]): string {
  return s === "atende" ? "✓" : s === "parcial" ? "△" : "✕";
}

function peScoreColor(score: number): string {
  if (score >= 80) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 50) return "bg-amber-100 text-amber-800 border-amber-300";
  if (score >= 20) return "bg-orange-100 text-orange-800 border-orange-300";
  return "bg-red-100 text-red-800 border-red-300";
}

function CascataBlock({
  req,
  incluirInternacional,
  incluirCaptacao,
  considerarPE,
}: {
  req: RequisitoCascata;
  incluirInternacional: boolean;
  incluirCaptacao: boolean;
  considerarPE: boolean;
}) {
  const nivelMap = new Map(req.niveis.map((n) => [n.nivel, n]));
  const candidatos: Nivel[] = [];
  if (nivelMap.get("nacional")) candidatos.push(nivelMap.get("nacional")!);
  if (incluirInternacional && nivelMap.get("internacional")) candidatos.push(nivelMap.get("internacional")!);
  if (incluirCaptacao && nivelMap.get("captacao")) candidatos.push(nivelMap.get("captacao")!);

  const nivelEfetivo = candidatos.find((n) => n.status === "atende") ?? candidatos[candidatos.length - 1] ?? req.niveis[0];
  let statusEfetivo: Nivel["status"] = nivelEfetivo?.status ?? "nao_atende";
  const peAceito = considerarPE && req.equivalencia_pe && req.equivalencia_pe.pe_score >= 50;
  if (peAceito && statusEfetivo !== "atende") statusEfetivo = "atende";

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className={`px-4 py-3 border-l-4 ${nivelStatusColor(statusEfetivo)}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-sm">{req.requisito}</div>
            <div className="text-xs text-slate-600 mt-0.5">
              Mínimo exigido: <span className="font-medium">{fmtValor(req.minimo_exigido, req.unidade)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg leading-none">{nivelStatusIcon(statusEfetivo)}</div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mt-1">
              {statusEfetivo === "atende" ? "Atende" : statusEfetivo === "parcial" ? "Parcial" : "Não atende"}
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {req.niveis.map((n) => {
          const desabilitado =
            (n.nivel === "internacional" && !incluirInternacional) ||
            (n.nivel === "captacao" && !incluirCaptacao);
          return (
            <details key={n.nivel} className={`group ${desabilitado ? "opacity-50" : ""}`} open={n.status === "atende" && !desabilitado}>
              <summary className="cursor-pointer px-4 py-2 flex items-center justify-between hover:bg-slate-50 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-base">{nivelStatusIcon(n.status)}</span>
                  <span className="font-medium">{nivelLabel(n.nivel)}</span>
                  {desabilitado && <span className="text-xs text-slate-400">(toggle off)</span>}
                </span>
                <span className="text-xs text-slate-600 tabular-nums">
                  {fmtValor(n.valor_acumulado, n.unidade ?? req.unidade)}
                  {n.delta != null && (
                    <span className={`ml-2 ${n.delta >= 0 ? "text-green-700" : "text-red-700"}`}>
                      ({n.delta >= 0 ? "+" : ""}
                      {fmtValor(n.delta, n.unidade ?? req.unidade)})
                    </span>
                  )}
                </span>
              </summary>
              {n.observacao && (
                <div className="px-4 pb-2 text-xs italic text-amber-700">⚠ {n.observacao}</div>
              )}
              {n.contribuintes.length > 0 && (
                <ul className="px-4 pb-3 space-y-1">
                  {n.contribuintes.map((c, i) => (
                    <li key={i} className="text-xs text-slate-700 flex items-baseline gap-2">
                      <span className="text-slate-400 w-20 shrink-0 capitalize">{c.fonte}</span>
                      <span className="flex-1 truncate">{c.rotulo}</span>
                      <span className="tabular-nums text-slate-600 shrink-0">
                        {fmtValor(c.valor, c.unidade ?? n.unidade ?? req.unidade)}
                        {c.moeda_original && c.moeda_original !== "BRL" && c.valor_original != null && (
                          <span className="ml-1 text-slate-400">
                            ({c.valor_original.toLocaleString("pt-BR")} {c.moeda_original})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}

        {req.equivalencia_pe && (
          <div className="px-4 py-3 bg-blue-50/40">
            <div className="flex items-start gap-2">
              <span className={`badge border ${peScoreColor(req.equivalencia_pe.pe_score)} shrink-0`}>
                PE {req.equivalencia_pe.pe_score}%
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-700">Pedido de Esclarecimento sugerido</div>
                <div className="text-xs text-slate-600 mt-0.5">{req.equivalencia_pe.motivo}</div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-blue-700 hover:underline">Ver pergunta sugerida</summary>
                  <div className="mt-1 p-2 bg-white border border-slate-200 rounded text-xs whitespace-pre-line">
                    {req.equivalencia_pe.pergunta_sugerida}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    <strong>Se aceito:</strong> {req.equivalencia_pe.impacto_se_aceito}
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ParecerView({ parecer }: { parecer: Parecer }) {
  const cascata = parecer.requisitos_cascata ?? [];
  const cenarios = parecer.cenarios ?? [];

  const [incluirInternacional, setIncluirInternacional] = useState(false);
  const [incluirCaptacao, setIncluirCaptacao] = useState(false);
  const [considerarPE, setConsiderarPE] = useState(false);

  const cenarioAtivo = useMemo(() => {
    if (incluirInternacional || considerarPE) return cenarios.find((c) => c.nome === "otimista");
    return cenarios.find((c) => c.nome === "conservador");
  }, [incluirInternacional, considerarPE, cenarios]);

  const scoreExibido = cenarioAtivo?.score_aderencia ?? parecer.score_aderencia;
  const statusExibido = cenarioAtivo?.status ?? parecer.status;

  const atendidosLocal = useMemo(() => {
    return cascata.filter((r) => {
      const nivelMap = new Map(r.niveis.map((n) => [n.nivel, n]));
      if (nivelMap.get("nacional")?.status === "atende") return true;
      if (incluirInternacional && nivelMap.get("internacional")?.status === "atende") return true;
      if (incluirCaptacao && nivelMap.get("captacao")?.status === "atende") return true;
      if (considerarPE && r.equivalencia_pe && r.equivalencia_pe.pe_score >= 50) return true;
      return false;
    }).length;
  }, [cascata, incluirInternacional, incluirCaptacao, considerarPE]);

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs text-slate-500 uppercase">Parecer</div>
            <h2 className="text-xl font-bold">{parecer.edital_orgao || "—"}</h2>
            {parecer.edital_modalidade && (
              <div className="text-sm text-slate-500">{parecer.edital_modalidade}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-5xl font-bold tabular-nums">{scoreExibido ?? "—"}</div>
            <span className={`badge ${statusBadge(statusExibido)} mt-2`}>{statusExibido}</span>
            {cascata.length > 0 && (
              <div className="text-xs text-slate-500 mt-2">
                {atendidosLocal} de {cascata.length} requisitos atendidos
              </div>
            )}
          </div>
        </div>
        {parecer.bloqueio_camada_1 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
            <strong>Bloqueio camada 1:</strong> {parecer.bloqueio_camada_1}
          </div>
        )}
      </div>

      {cenarios.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-slate-600">Cenários</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cenarios.map((c) => {
              const isAtivo = cenarioAtivo?.nome === c.nome;
              return (
                <div
                  key={c.nome}
                  className={`p-3 border rounded-lg ${
                    isAtivo ? "border-blue-400 bg-blue-50/50" : "border-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm capitalize">{c.nome}</div>
                    <span className={`badge ${statusBadge(c.status)}`}>{c.status}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div className="text-3xl font-bold tabular-nums">{c.score_aderencia ?? "—"}</div>
                    <div className="text-xs text-slate-500">
                      {c.requisitos_atendidos_count}/{c.requisitos_total} requisitos
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 mt-2">{c.descricao}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cascata.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold">Cascata de comprovação por requisito ({cascata.length})</h3>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirInternacional}
                  onChange={(e) => setIncluirInternacional(e.target.checked)}
                  className="rounded"
                />
                <span>Incluir internacionais</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirCaptacao}
                  onChange={(e) => setIncluirCaptacao(e.target.checked)}
                  className="rounded"
                />
                <span>Incluir captação</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={considerarPE}
                  onChange={(e) => setConsiderarPE(e.target.checked)}
                  className="rounded"
                />
                <span>Considerar PEs (≥50%) aceitos</span>
              </label>
            </div>
          </div>
          <div className="space-y-3">
            {cascata.map((req, i) => (
              <CascataBlock
                key={i}
                req={req}
                incluirInternacional={incluirInternacional}
                incluirCaptacao={incluirCaptacao}
                considerarPE={considerarPE}
              />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold mb-2">Estratégia</h3>
        <p className="text-sm whitespace-pre-line text-slate-700">{parecer.estrategia}</p>
      </div>

      {parecer.alertas?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Alertas</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
            {parecer.alertas.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {parecer.requisitos_atendidos?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Requisitos atendidos ({parecer.requisitos_atendidos.length})</h3>
          <div className="space-y-3">
            {parecer.requisitos_atendidos.map((r, i) => (
              <div key={i} className="border-l-2 border-green-400 pl-3">
                <div className="text-sm font-medium">{r.requisito}</div>
                <div className="text-xs text-slate-600">{r.comprovacao}</div>
                <div className="text-xs text-slate-400 mt-1">
                  fonte: {r.fonte}
                  {r.link ? ` · ${r.link}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {parecer.evidencias_por_requisito?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Evidências auditáveis ({parecer.evidencias_por_requisito.length})</h3>
          <div className="space-y-3">
            {parecer.evidencias_por_requisito.map((e, i) => (
              <details key={i} className="border border-slate-200 rounded-lg p-3">
                <summary className="cursor-pointer text-sm font-medium flex items-center justify-between gap-2">
                  <span className="flex-1 min-w-0">
                    {e.atestado_nome ? `${e.atestado_nome} — ` : ""}{e.requisito}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {e.valor_comprovado != null && (
                      <span className="text-xs font-semibold text-green-700">
                        {e.unidade_valor === "BRL"
                          ? e.valor_comprovado.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
                          : `${e.valor_comprovado.toLocaleString("pt-BR")} ${e.unidade_valor || ""}`}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      {e.tipo_evidencia} · {Math.round(e.confianca * 100)}%
                    </span>
                    {e.atestado_link && (
                      <a href={e.atestado_link} target="_blank" rel="noreferrer"
                         className="text-xs text-blue-600 hover:underline"
                         onClick={(ev) => ev.stopPropagation()}>
                        Drive ↗
                      </a>
                    )}
                  </span>
                </summary>
                <div className="mt-2 text-xs text-slate-600 space-y-1.5">
                  {e.texto_edital && (
                    <blockquote className="border-l-2 border-blue-300 pl-2 italic text-slate-500">
                      <strong>Requisito do edital:</strong> {e.texto_edital}
                    </blockquote>
                  )}
                  {e.atestado_resumo && (
                    <div>
                      <strong>Resumo do documento:</strong> {e.atestado_resumo}
                    </div>
                  )}
                  <div className="mt-1 italic text-slate-700">&ldquo;{e.trecho_literal}&rdquo;</div>
                  <div className="text-slate-400">
                    <strong>Tabela:</strong> {e.fonte_tabela} · <strong>ID:</strong> {e.fonte_id || "—"}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {parecer.gaps?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Gaps ({parecer.gaps.length})</h3>
          <div className="space-y-2 text-sm">
            {parecer.gaps.map((g, i) => (
              <div key={i} className="border-l-2 border-amber-400 pl-3">
                <div className="font-medium">{g.requisito}</div>
                <div className="text-xs text-slate-500">
                  tipo: {g.tipo}
                  {g.delta_numerico != null ? ` · Δ ${g.delta_numerico}` : ""}
                </div>
                <div className="text-xs text-slate-700">{g.recomendacao}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
