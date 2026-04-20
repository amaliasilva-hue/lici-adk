'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────
type Evidencia = {
  requisito: string;
  texto_edital?: string;       // verbatim do edital para este requisito
  fonte_tabela: string;
  fonte_id?: string;
  trecho_literal: string;
  tipo_evidencia: 'atestado' | 'contrato' | 'deal_won' | 'certificado' | 'yaml';
  confianca: number;
  atestado_nome?: string;      // nomedaconta do AtestadoMatch
  atestado_resumo?: string;    // resumodoatestado
  atestado_link?: string;      // linkdeacesso
};

type Gap = {
  requisito: string;
  tipo: string;
  delta_numerico?: number;
  recomendacao: string;
};

type ContribuinteEvidencia = {
  fonte: 'atestado' | 'contrato' | 'drive_pdf';
  fonte_id?: string;
  rotulo: string;
  valor?: number;
  unidade?: string;
  link?: string;
};

type NivelComprovacao = {
  nivel: 'nacional' | 'internacional' | 'captacao';
  status: 'atende' | 'parcial' | 'nao_atende';
  valor_acumulado: number;
  unidade?: string;
  delta?: number;
  contribuintes: ContribuinteEvidencia[];
  observacao?: string;
};

type RequisitoCascata = {
  requisito: string;
  minimo_exigido: number;
  unidade: string;
  niveis: NivelComprovacao[];
  status_consolidado: 'atende' | 'parcial' | 'nao_atende';
  nivel_que_satisfaz?: string;
};

type ParecerComercial = {
  score_aderencia?: number;
  status: string;
  bloqueio_camada_1?: string;
  requisitos_atendidos?: Array<{ requisito: string; comprovacao: string; fonte: string; link?: string }>;
  evidencias_por_requisito?: Evidencia[];
  gaps?: Gap[];
  estrategia?: string;
  alertas?: string[];
  requisitos_cascata?: RequisitoCascata[];
};

type AtestadoRecomendado = {
  drive_file_id?: string;
  drive_file_name?: string;
  contratante?: string;
  volume_contribuido?: number;
  satisfaz_parcela_maior_relevancia?: boolean;
};

type CertidaoChecklist = {
  nome: string;
  obrigatorio?: boolean;
  validade_dias?: number;
};

type KitHabilitacao = {
  atestados_recomendados?: AtestadoRecomendado[];
  declaracoes_necessarias?: string[];
  certidoes_checklist?: CertidaoChecklist[];
  gap_habilitacao?: string;
};

type AtestadoAnalise = {
  permite_somatorio?: boolean;
  exige_parcela_maior_relevancia?: boolean;
  percentual_minimo?: number;
  restricao_temporal?: boolean;
  restricao_local?: boolean;
  conformidade?: string;
  fundamentacao?: string;
  alertas?: string[];
};

type DocumentoProtocolo = {
  tipo: 'ESCLARECIMENTO' | 'IMPUGNACAO';
  topico: string;
  numero_clausula?: string;
  clausula_questionada: string;
  prazo_limite?: string;
  destinatario: string;
  texto_formal: string;
  base_legal?: string[];
};

type RelatorioJuridico = {
  ficha_processo?: {
    orgao?: string;
    objeto?: string;
    prazos_calculados?: { data_limite_impugnacao?: string; data_limite_esclarecimento?: string };
  };
  atestado_analise?: AtestadoAnalise;
  risco_juridico?: { nivel_risco?: string; clausulas_restritivas?: string[]; riscos?: string[] };
  documentos_protocolo?: DocumentoProtocolo[];
  resumo_executivo?: {
    conformidade_geral?: string;
    score_conformidade?: number;
    pontos_criticos?: string[];
    recomendacao?: string;
    recomendacao_go_nogo?: string;
  };
  kit_habilitacao?: KitHabilitacao;
};

type Comentario = { comentario_id: string; autor_email: string; texto: string; criado_em: string };
type Gate = { gate_id: string; stage: string; gate_key: string; label: string; concluido: boolean; concluido_por?: string; concluido_em?: string };
type Mov = { mov_id: string; fase_origem: string; fase_destino: string; autor_email: string; motivo?: string; criado_em: string };

type Edital = {
  edital_id?: string;
  analysis_id?: string;
  orgao?: string;
  uf?: string;
  objeto?: string;
  uasg?: string;
  numero_pregao?: string;
  portal?: string;
  valor_estimado?: number;
  data_encerramento?: string;
  fase_atual?: string;
  estado_terminal?: string;
  vendedor_email?: string;
  score_comercial?: number;
  prioridade?: number;
  criado_em?: string;
  status?: string;
  current_agent?: string;
  edital_filename?: string;
  result?: ParecerComercial;
  relatorio_juridico?: RelatorioJuridico;
  job_juridico_status?: string;
  comentarios?: Comentario[];
  gates?: Gate[];
  movimentacoes?: Mov[];
};

const STAGES: Record<string, string> = {
  identificacao: 'Identificação', analise: 'Análise', pre_disputa: 'Pré-disputa',
  proposta: 'Proposta', disputa: 'Disputa', habilitacao: 'Habilitação',
  recursos: 'Recursos', homologado: 'Homologado',
};
const TERMINAIS = ['ganho', 'perdido', 'inabilitado', 'revogado', 'nao_participamos'];

// ─── Helper: score color ──────────────────────────────────
function scoreColor(s?: number) {
  if (s == null) return 'text-slate-300';
  if (s >= 70) return 'text-green-700';
  if (s >= 45) return 'text-blue-600';
  return 'text-red-600';
}

const GATE_LABELS: Record<string, string> = {
  edital_baixado: 'Edital baixado',
  orgao_identificado: 'Órgão identificado',
  vendedor_atribuido: 'Vendedor atribuído',
  analise_comercial_concluida: 'Análise comercial concluída',
  analise_juridica_concluida: 'Análise jurídica concluída',
  prazo_verificado: 'Prazo verificado',
  documentos_redigidos: 'Documentos redigidos',
  proposta_tecnica_redigida: 'Proposta técnica redigida',
  proposta_comercial_precificada: 'Proposta comercial precificada',
  credenciamento_portal: 'Credenciamento no portal',
  proposta_enviada: 'Proposta enviada',
  kit_habilitacao_completo: 'Kit de habilitação completo',
  certidoes_validas: 'Certidões válidas',
  prazo_recurso_verificado: 'Prazo de recurso verificado',
  contrarrazoes_redigidas: 'Contrarrazões redigidas',
  ata_salva_drive: 'Ata salva no Drive',
};

function statusBadge(s?: string) {
  if (!s) return 'badge-gray';
  if (s === 'APTO') return 'badge-green';
  if (s === 'APTO COM RESSALVAS') return 'badge-orange';
  if (s === 'INAPTO') return 'badge-red';
  if (s === 'NO-GO') return 'badge-red';
  return 'badge-gray';
}

function riskColor(r?: string) {
  if (r === 'BAIXO') return 'badge-green';
  if (r === 'MEDIO') return 'badge-orange';
  if (r === 'ALTO') return 'badge-red';
  if (r === 'CRITICO') return 'badge-red';
  return 'badge-gray';
}

function conform(c?: string) {
  if (c === 'CONFORME') return 'badge-green';
  if (c === 'RESTRITIVO') return 'badge-orange';
  if (c === 'IRREGULAR') return 'badge-red';
  return 'badge-gray';
}

// ─── Accordion ────────────────────────────────────────────
function Accordion({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <details className="accordion">
      <summary>
        <span>{title}{count != null ? <span className="ml-1.5 text-slate-400 font-normal">({count})</span> : ''}</span>
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}

// ─── Copy button ──────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="btn btn-ghost btn-sm shrink-0"
    >
      {copied ? '✓ Copiado' : 'Copiar'}
    </button>
  );
}

// ─── Section: Atestados e Habilitação ─────────────────────
function AtestadosSection({ parecer, juridico }: { parecer?: ParecerComercial; juridico?: RelatorioJuridico }) {
  const evidencias = parecer?.evidencias_por_requisito ?? [];
  const atestados  = evidencias.filter(e => e.tipo_evidencia === 'atestado');
  const contratos  = evidencias.filter(e => e.tipo_evidencia === 'contrato');
  const certifics  = evidencias.filter(e => e.tipo_evidencia === 'certificado');
  const gaps       = parecer?.gaps ?? [];
  const cascatas   = parecer?.requisitos_cascata ?? [];

  const kitJur = juridico?.kit_habilitacao;
  const ateRecomendados = kitJur?.atestados_recomendados ?? [];
  const certidoes = kitJur?.certidoes_checklist ?? [];
  const gapHab = kitJur?.gap_habilitacao;

  const atestadoAnalise = juridico?.atestado_analise;

  const hasAny = evidencias.length > 0 || ateRecomendados.length > 0 || gaps.length > 0 || cascatas.length > 0;
  if (!hasAny && !gapHab && !atestadoAnalise) return null;

  // Group evidencias by requisito
  const byRequisito = (evs: Evidencia[]) => {
    const m = new Map<string, Evidencia[]>();
    for (const e of evs) {
      const key = e.requisito ?? 'Requisito';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return Array.from(m.entries());
  };

  // Find cascata matching a requisito label
  const findCascata = (req: string) =>
    cascatas.find(c => c.requisito.toLowerCase().includes(req.toLowerCase().slice(0, 20)));

  // Status icon for cascata level
  function nivelIcon(s: NivelComprovacao['status']) {
    if (s === 'atende') return <span className="text-[#C0FF7D]">✓</span>;
    if (s === 'parcial') return <span className="text-[#FCD34D]">~</span>;
    return <span className="text-[#F87171]">✗</span>;
  }

  // Evidence card for a single atestado/contrato evidence
  function EvidCard({ e }: { e: Evidencia }) {
    const isAtestado = e.tipo_evidencia === 'atestado';
    const name = e.atestado_nome ?? e.fonte_id ?? '—';
    const summary = e.atestado_resumo ?? e.trecho_literal;
    const link = e.atestado_link;
    const pct = Math.round(e.confianca * 100);
    return (
      <div className="rounded-lg border p-3 flex flex-col gap-1.5"
           style={{ background: 'rgba(0,0,0,0.2)', borderColor: 'rgba(255,255,255,0.08)' }}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 font-bold
              ${isAtestado ? 'bg-[rgba(192,255,125,0.15)] text-[#C0FF7D]' : 'bg-[rgba(245,158,11,0.15)] text-[#FCD34D]'}`}>
              {isAtestado ? '✓' : '○'}
            </span>
            <span className="text-sm font-semibold text-slate-200 truncate">{name}</span>
            {e.fonte_id && (
              <span className="text-[10px] text-slate-500 font-mono shrink-0">#{e.fonte_id.slice(0,8)}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`badge text-[10px] py-0 ${pct >= 80 ? 'badge-green' : pct >= 50 ? 'badge-blue' : 'badge-orange'}`}>
              {pct}%
            </span>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm py-0 px-2">
                Drive ↗
              </a>
            )}
          </div>
        </div>
        {/* Evidence text */}
        {summary && (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-4 pl-7">{summary}</p>
        )}
        {/* If atestado_resumo differs from trecho_literal, show the specific matching snippet */}
        {e.atestado_resumo && e.trecho_literal && e.trecho_literal !== e.atestado_resumo && (
          <div className="pl-7 mt-0.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Trecho relevante: </span>
            <span className="text-xs text-[#00BEFF] italic">"{e.trecho_literal}"</span>
          </div>
        )}
      </div>
    );
  }

  // Cascata/soma display for a specific requisito
  function CascataCard({ c }: { c: RequisitoCascata }) {
    const statusColor = c.status_consolidado === 'atende' ? 'text-[#C0FF7D]'
      : c.status_consolidado === 'parcial' ? 'text-[#FCD34D]' : 'text-[#F87171]';
    const borderColor = c.status_consolidado === 'atende' ? 'rgba(192,255,125,0.2)'
      : c.status_consolidado === 'parcial' ? 'rgba(245,158,11,0.2)' : 'rgba(225,72,73,0.2)';

    return (
      <div className="rounded-lg p-3 mt-2" style={{ background: 'rgba(0,0,0,0.15)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-xs font-semibold text-slate-300">Somatório</span>
          <span className="text-xs text-slate-500">
            Mínimo: {c.minimo_exigido.toLocaleString('pt-BR')} {c.unidade}
          </span>
          <span className={`ml-auto text-xs font-bold ${statusColor}`}>
            {c.status_consolidado === 'atende' ? '✓ Atende' : c.status_consolidado === 'parcial' ? '~ Parcial' : '✗ Insuficiente'}
          </span>
        </div>
        {c.niveis.map((n, i) => (
          <div key={i} className="pl-3 border-l border-white/10 mb-2 last:mb-0">
            <div className="flex items-center gap-2 text-xs mb-1">
              {nivelIcon(n.status)}
              <span className="text-slate-300 capitalize">{n.nivel}</span>
              <span className="text-slate-500">
                {n.valor_acumulado.toLocaleString('pt-BR')} {n.unidade ?? c.unidade}
              </span>
              {n.delta != null && n.delta < 0 && (
                <span className="text-[#F87171]">faltam {Math.abs(n.delta).toLocaleString('pt-BR')}</span>
              )}
            </div>
            {n.contribuintes.length > 0 && (
              <div className="space-y-0.5 pl-3">
                {n.contribuintes.map((ct, j) => (
                  <div key={j} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="w-1 h-1 rounded-full bg-slate-600 shrink-0" />
                    <span className="truncate">{ct.rotulo}</span>
                    {ct.valor != null && (
                      <span className="text-slate-400 shrink-0">{ct.valor.toLocaleString('pt-BR')} {ct.unidade}</span>
                    )}
                    {ct.link && (
                      <a href={ct.link} target="_blank" rel="noreferrer" className="text-[#00BEFF] shrink-0">↗</a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {n.observacao && <p className="text-[11px] text-slate-500 italic pl-3 mt-1">{n.observacao}</p>}
          </div>
        ))}
      </div>
    );
  }

  // Requirement block: edital text + evidence cards + optional cascata
  function RequisitoBlock({ req, evs, tipo }: { req: string; evs: Evidencia[]; tipo: string }) {
    const editalText = evs[0]?.texto_edital;
    const cascata = findCascata(req);
    const statusAtende = evs.some(e => e.confianca >= 0.7);
    const badgeCls = statusAtende ? 'badge-green' : 'badge-orange';
    const badgeTxt = statusAtende ? 'Atendido' : 'Parcial';

    return (
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {/* Requisito header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{tipo}</span>
              <span className={`badge ${badgeCls} text-[10px] py-0`}>{badgeTxt}</span>
            </div>
            {/* Edital verbatim text */}
            {editalText ? (
              <blockquote className="text-sm text-slate-300 leading-relaxed border-l-2 pl-3 italic"
                          style={{ borderColor: 'rgba(0,190,255,0.4)' }}>
                {editalText}
              </blockquote>
            ) : (
              <p className="text-sm text-slate-300 leading-relaxed font-medium">{req}</p>
            )}
          </div>
        </div>

        {/* Evidence cards */}
        <div className="space-y-2">
          {evs.map((e, i) => <EvidCard key={i} e={e} />)}
        </div>

        {/* Cascata/soma if available */}
        {cascata && <CascataCard c={cascata} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="font-poppins font-bold text-lg text-slate-900">Habilitação Técnica</h2>

      {/* TCU: Somatório analysis */}
      {atestadoAnalise && (
        <div className="section-card section-card-blue">
          <p className="section-title">Análise TCU — Atestados de Capacidade</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className={`badge ${conform(atestadoAnalise.conformidade)}`}>
              {atestadoAnalise.conformidade ?? '—'}
            </span>
            {atestadoAnalise.permite_somatorio != null && (
              <span className={`badge ${atestadoAnalise.permite_somatorio ? 'badge-green' : 'badge-red'}`}>
                {atestadoAnalise.permite_somatorio ? 'Somatório permitido' : 'Somatório vedado'}
              </span>
            )}
            {atestadoAnalise.restricao_temporal && (
              <span className="badge badge-red">⚠ Restrição temporal (TCU S-003)</span>
            )}
            {atestadoAnalise.restricao_local && (
              <span className="badge badge-red">⚠ Restrição geográfica (TCU S-004)</span>
            )}
            {atestadoAnalise.percentual_minimo != null && (
              <span className="badge badge-gray">PMR: {atestadoAnalise.percentual_minimo}%</span>
            )}
          </div>
          {atestadoAnalise.fundamentacao && (
            <p className="text-sm text-slate-600 leading-relaxed">{atestadoAnalise.fundamentacao}</p>
          )}
          {(atestadoAnalise.alertas?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1">
              {atestadoAnalise.alertas!.map((a, i) => (
                <li key={i} className="text-xs text-orange-600 flex gap-1.5">
                  <span>⚠</span><span>{a}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Requisitos com atestados ───────────────────── */}
      {atestados.length > 0 && (
        <div className="space-y-3">
          <p className="section-title px-1">
            Requisitos técnicos — atestados formais
            <span className="ml-1.5 text-[#C0FF7D]/60">({byRequisito(atestados).length})</span>
          </p>
          {byRequisito(atestados).map(([req, evs], i) => (
            <RequisitoBlock key={i} req={req} evs={evs} tipo="Atestado" />
          ))}
        </div>
      )}

      {/* ── Kit jurídico: atestados recomendados ──────── */}
      {ateRecomendados.length > 0 && atestados.length === 0 && (
        <div className="section-card section-card-green">
          <p className="section-title">Atestados recomendados pelo Analista Jurídico</p>
          <p className="text-xs text-slate-400 mb-3">Documentos do Drive identificados como comprovação de capacidade técnica</p>
          <div className="space-y-0">
            {ateRecomendados.map((a, i) => (
              <div key={i} className="evidence-row">
                <div className="evidence-icon bg-green-100 text-green-700">✓</div>
                <div className="evidence-meta">
                  <div className="evidence-source">
                    {a.drive_file_name ?? a.contratante ?? `Atestado ${i+1}`}
                    {a.satisfaz_parcela_maior_relevancia && (
                      <span className="ml-2 badge badge-green text-[10px] py-0">PMR ✓</span>
                    )}
                  </div>
                  <div className="evidence-excerpt">
                    {a.contratante && `Contratante: ${a.contratante}`}
                    {a.volume_contribuido != null && ` · Volume: ${a.volume_contribuido.toLocaleString('pt-BR')}`}
                    {a.satisfaz_parcela_maior_relevancia
                      ? ' · Satisfaz parcela de maior relevância (art. 67 §1º)'
                      : ' · Contribui para somatório de atestados'}
                  </div>
                </div>
                {a.drive_file_id && (
                  <a href={`https://drive.google.com/file/d/${a.drive_file_id}`}
                     target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm shrink-0">
                    Drive ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Cascatas avulsas (sem evidência vinculada) ─── */}
      {cascatas.filter(c => !byRequisito(atestados).find(([req]) => req.toLowerCase().includes(c.requisito.toLowerCase().slice(0,20)))).length > 0 && (
        <div className="space-y-3">
          <p className="section-title px-1">Análise de somatório — requisitos quantitativos</p>
          {cascatas.map((c, i) => (
            <div key={i} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-sm font-medium text-slate-300 mb-2">{c.requisito}</p>
              <CascataCard c={c} />
            </div>
          ))}
        </div>
      )}

      {/* ── Contratos sem atestado formal ─────────────── */}
      {contratos.length > 0 && (
        <div className="space-y-3">
          <p className="section-title px-1">
            Contratos sem atestado formal — solicitar emissão
            <span className="ml-1.5 text-[#FCD34D]/60">({byRequisito(contratos).length})</span>
          </p>
          <div className="alert-warning">
            <strong>Ação necessária:</strong> Os contratos abaixo comprovam experiência mas não possuem atestado emitido. Solicite ao cliente o documento para compor o kit de habilitação.
          </div>
          {byRequisito(contratos).map(([req, evs], i) => (
            <RequisitoBlock key={i} req={req} evs={evs} tipo="Contrato (sem atestado)" />
          ))}
        </div>
      )}

      {/* ── Gaps de habilitação ────────────────────────── */}
      {(gaps.length > 0 || gapHab) && (
        <div className="section-card section-card-red">
          <p className="section-title">
            Gaps de Habilitação
            {gaps.length > 0 && <span className="ml-1.5 text-[#F87171]/60">({gaps.length})</span>}
          </p>
          <div className="space-y-3">
            {gaps.map((g, i) => (
              <div key={i} className="gap-item">
                <div className="flex flex-wrap gap-2 mb-1">
                  <span className="badge badge-orange text-[11px]">{g.tipo?.replace(/_/g,' ')}</span>
                  {g.delta_numerico != null && (
                    <span className="badge badge-red text-[11px]">Delta: {g.delta_numerico.toLocaleString('pt-BR')}</span>
                  )}
                </div>
                <div className="gap-item-title">{g.requisito}</div>
                <div className="gap-item-sub">{g.recomendacao}</div>
              </div>
            ))}
          </div>
          {gapHab && <div className="mt-3 alert-warning text-sm">{gapHab}</div>}
        </div>
      )}

      {/* ── Certidões ──────────────────────────────────── */}
      {certidoes.length > 0 && (
        <div className="section-card">
          <p className="section-title">Certidões Necessárias</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {certidoes.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${c.obrigatorio ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                  {c.obrigatorio ? '!' : '○'}
                </span>
                <span className="text-slate-700">{c.nome}</span>
                {c.validade_dias && <span className="text-slate-400 text-xs">{c.validade_dias}d</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Certificações ──────────────────────────────── */}
      {certifics.length > 0 && (
        <div className="space-y-3">
          <p className="section-title px-1">Certificações</p>
          {byRequisito(certifics).map(([req, evs], i) => (
            <RequisitoBlock key={i} req={req} evs={evs} tipo="Certificação" />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────
export default function EditalPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [edital, setEdital] = useState<Edital | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [patchFase, setPatchFase] = useState('');
  const [patchTerminal, setPatchTerminal] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<'resumo' | 'comercial' | 'juridico' | 'habilitacao'>('resumo');
  const [juridicError, setJuridicError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/proxy/editais/${id}`);
      if (!r.ok) { setError(`Edital não encontrado (${r.status})`); return; }
      const data = await r.json();
      setEdital(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!edital) return;
    if (edital.status && ['queued', 'running'].includes(edital.status)) {
      const t = setTimeout(load, 3000);
      return () => clearTimeout(t);
    }
  }, [edital, load]);

  async function postComentario() {
    if (!comentario.trim() || !edital) return;
    setPostingComment(true);
    try {
      await fetch(`/api/proxy/editais/${id}/comentarios`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto: comentario, autor_email: 'usuario@xertica.com' }),
      });
      setComentario('');
      await load();
    } finally { setPostingComment(false); }
  }

  async function toggleGate(gate: Gate) {
    await fetch(`/api/proxy/editais/${id}/gates/${gate.gate_key}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concluido: !gate.concluido, autor_email: 'usuario@xertica.com' }),
    });
    await load();
  }

  async function saveStage() {
    if (!patchFase && !patchTerminal) return;
    setSaving(true);
    try {
      const body: any = { autor_email: 'usuario@xertica.com' };
      if (patchFase) body.fase_atual = patchFase;
      if (patchTerminal) body.estado_terminal = patchTerminal;
      await fetch(`/api/proxy/editais/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setPatchFase(''); setPatchTerminal('');
      await load();
    } finally { setSaving(false); }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-3">
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Carregando edital…
    </div>
  );
  if (error) return <div className="alert-danger max-w-lg mx-auto mt-16">{error}</div>;
  if (!edital) return null;

  const parecer  = edital.result;
  const juridico = edital.relatorio_juridico;
  const score    = edital.score_comercial ?? parecer?.score_aderencia;
  const isRunning = edital.status && ['queued','running'].includes(edital.status);

  const gatesTotal     = edital.gates?.length ?? 0;
  const gatesDone      = edital.gates?.filter(g => g.concluido).length ?? 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* ── Breadcrumb ─────────────────────────────────── */}
      <div className="text-sm text-slate-400 flex items-center gap-1.5">
        <Link href="/" className="hover:text-slate-900 transition-colors">Pipeline</Link>
        <span>/</span>
        <span className="text-slate-600">{edital.orgao || id}</span>
      </div>

      {/* ── Header card ────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          {/* Left: info */}
          <div className="flex-1 min-w-0">
            <h1 className="font-poppins font-bold text-2xl text-slate-900 leading-tight mb-1">
              {edital.orgao || '—'}
            </h1>
            <p className="text-slate-500 text-sm mb-3 leading-relaxed">
              {edital.objeto || edital.edital_filename || '—'}
            </p>
            <div className="flex flex-wrap gap-2">
              {edital.uf && <span className="badge badge-gray">{edital.uf}</span>}
              {edital.uasg && <span className="badge badge-blue">UASG {edital.uasg}</span>}
              {edital.numero_pregao && <span className="badge badge-gray">{edital.numero_pregao}</span>}
              {edital.portal && <span className="badge badge-blue">{edital.portal}</span>}
              {edital.fase_atual && !edital.estado_terminal && (
                <span className="badge badge-blue">{STAGES[edital.fase_atual] ?? edital.fase_atual}</span>
              )}
              {edital.estado_terminal && (
                <span className={`badge ${edital.estado_terminal === 'ganho' ? 'badge-green' : 'badge-red'}`}>
                  ● {edital.estado_terminal}
                </span>
              )}
              {parecer?.status && (
                <span className={`badge ${statusBadge(parecer.status)}`}>{parecer.status}</span>
              )}
            </div>
          </div>

          {/* Right: score */}
          <div className="shrink-0 text-right">
            {score != null ? (
              <>
                <div className={`score-number ${scoreColor(score)}`}>{score}</div>
                <div className="text-xs text-slate-400 mt-0.5">score comercial</div>
              </>
            ) : isRunning ? (
              <div className="text-slate-400 text-sm mt-2">Analisando…</div>
            ) : (
              <div className="score-number text-slate-200">—</div>
            )}
          </div>
        </div>

        {/* Info grid */}
        <div className="divider" />
        <div className="info-grid">
          <div className="info-grid-item">
            <label>Valor estimado</label>
            <span>{edital.valor_estimado
              ? `R$ ${edital.valor_estimado.toLocaleString('pt-BR')}`
              : '—'}</span>
          </div>
          <div className="info-grid-item">
            <label>Encerramento</label>
            <span>{edital.data_encerramento
              ? new Date(edital.data_encerramento).toLocaleDateString('pt-BR')
              : '—'}</span>
          </div>
          <div className="info-grid-item">
            <label>Gates</label>
            <span>{gatesTotal > 0
              ? `${gatesDone}/${gatesTotal} concluídos`
              : '—'}</span>
          </div>
          <div className="info-grid-item">
            <label>Responsável</label>
            <span className="truncate">{edital.vendedor_email ?? '—'}</span>
          </div>
        </div>

        {/* Prazos do Analista Jurídico */}
        {juridico?.ficha_processo?.prazos_calculados && (
          <>
            <div className="divider" />
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              {juridico.ficha_processo.prazos_calculados.data_limite_impugnacao && (
                <span>
                  <span className="text-danger font-medium">Impugnação até: </span>
                  {juridico.ficha_processo.prazos_calculados.data_limite_impugnacao}
                </span>
              )}
              {juridico.ficha_processo.prazos_calculados.data_limite_esclarecimento && (
                <span>
                  <span className="text-orange-600 font-medium">Esclarecimento até: </span>
                  {juridico.ficha_processo.prazos_calculados.data_limite_esclarecimento}
                </span>
              )}
            </div>
          </>
        )}

        {/* Pipeline running status */}
        {isRunning && (
          <div className="mt-4 alert-info flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Agente <strong>{edital.current_agent ?? 'pipeline'}</strong> em execução… atualização automática em 3s
          </div>
        )}

        {/* Bloqueio camada 1 */}
        {parecer?.bloqueio_camada_1 && (
          <div className="mt-4 alert-danger">
            <strong>Bloqueio camada 1:</strong> {parecer.bloqueio_camada_1}
          </div>
        )}
      </div>

      {/* ── Tab navigation ──────────────────────────────── */}
      <div className="tab-bar">
        {(['resumo', 'comercial', 'juridico', 'habilitacao'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab-btn ${tab === t ? 'tab-btn-active' : ''}`}
          >
            {t === 'resumo'      ? 'Resumo'
           : t === 'comercial'   ? `Comercial${parecer ? ` · ${score ?? '—'}` : ''}`
           : t === 'juridico'    ? `Jurídico${juridico ? ' ✓' : ''}`
           : 'Habilitação'}
          </button>
        ))}
      </div>

      {/* ── Gestão: stage changer + gates ──────────────── */}
      {tab === 'resumo' && edital.edital_id && (
        <div className="card space-y-4">
          <h2 className="font-poppins font-bold text-base text-slate-900">Gestão do Processo</h2>

          {/* Stage changer */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-slate-400 mb-1 block uppercase tracking-wide">Mover para fase</label>
              <select value={patchFase} onChange={e => setPatchFase(e.target.value)} className="input w-44">
                <option value="">— selecione —</option>
                {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block uppercase tracking-wide">Estado terminal</label>
              <select value={patchTerminal} onChange={e => setPatchTerminal(e.target.value)} className="input w-48">
                <option value="">— nenhum —</option>
                {TERMINAIS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button
              onClick={saveStage}
              disabled={saving || (!patchFase && !patchTerminal)}
              className="btn btn-primary disabled:opacity-40"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>

          {/* Gates checklist */}
          {(edital.gates?.length ?? 0) > 0 && (
            <>
              <div className="divider" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-600">
                    Checklist — {STAGES[edital.fase_atual ?? ''] ?? edital.fase_atual}
                  </p>
                  <span className="text-xs text-slate-400">{gatesDone}/{gatesTotal}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-slate-200 rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: gatesTotal > 0 ? `${(gatesDone/gatesTotal)*100}%` : '0%' }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {edital.gates!.map(gate => (
                    <button key={gate.gate_id} onClick={() => toggleGate(gate)} className="checkbox-custom group text-left">
                      <div className={`checkbox-box ${gate.concluido ? 'checkbox-box-on' : 'checkbox-box-off'}`}>
                        {gate.concluido && (
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                          </svg>
                        )}
                      </div>
                      <span className={`text-sm ${gate.concluido ? 'line-through text-slate-400' : 'text-slate-700'} group-hover:text-slate-900 transition-colors`}>
                        {GATE_LABELS[gate.gate_key] ?? gate.label ?? gate.gate_key}
                      </span>
                      {gate.concluido_em && (
                        <span className="text-xs text-slate-300 ml-auto">
                          {new Date(gate.concluido_em).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Habilitação Técnica & Atestados ────────────── */}
      {tab === 'habilitacao' && <AtestadosSection parecer={parecer} juridico={juridico} />}

      {/* ── Análise Comercial ───────────────────────────── */}
      {tab === 'comercial' && parecer && (
        <div className="space-y-4">
          <h2 className="font-poppins font-bold text-lg text-slate-900">Análise Comercial</h2>

          {/* Estratégia */}
          {parecer.estrategia && (
            <div className="card">
              <p className="section-title">Estratégia</p>
              <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{parecer.estrategia}</p>
            </div>
          )}

          {/* Alertas */}
          {(parecer.alertas?.length ?? 0) > 0 && (
            <div className="card">
              <p className="section-title">Alertas ({parecer.alertas!.length})</p>
              <ul className="space-y-2">
                {parecer.alertas!.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-600">
                    <span className="text-orange-600 shrink-0">⚠</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Requisitos Atendidos */}
          {(parecer.requisitos_atendidos?.length ?? 0) > 0 && (
            <div className="card">
              <p className="section-title">Requisitos Atendidos ({parecer.requisitos_atendidos!.length})</p>
              <div className="space-y-0">
                {parecer.requisitos_atendidos!.map((r, i) => (
                  <div key={i} className="evidence-row">
                    <div className="evidence-icon bg-green-100 text-green-700 text-sm">✓</div>
                    <div className="evidence-meta">
                      <div className="evidence-source">{r.requisito}</div>
                      <div className="evidence-excerpt">{r.comprovacao}</div>
                    </div>
                    <span className="badge badge-gray shrink-0 text-[11px]">{r.fonte}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Análise Jurídica ─────────────────────────────── */}
      {/* Trigger button when not started yet */}
      {tab === 'juridico' && !juridico && edital.status !== 'running' && edital.status !== 'queued' && (
        <div className="card flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-slate-700 text-sm">Análise Jurídica</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {edital.job_juridico_status === 'running'
                ? 'Analisando edital com base na Lei 14.133/2021 e súmulas TCU…'
                : edital.job_juridico_status === 'failed'
                ? `Falha na análise jurídica`
                : 'Não iniciada — dispare para gerar relatório jurídico, kit de habilitação e minutas de impugnação/esclarecimento.'}
            </p>
          </div>
          {edital.job_juridico_status === 'running' ? (
            <div className="flex items-center gap-2 text-cyan-700 text-sm shrink-0">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Analisando…
            </div>
          ) : edital.job_juridico_status !== 'running' && (
            <button
              onClick={async () => {
                setJuridicError(null);
                const r = await fetch(`/api/proxy/editais/${edital.edital_id ?? edital.analysis_id}/analise_juridica`, { method: 'POST' });
                if (!r.ok) {
                  const body = await r.json().catch(() => ({}));
                  setJuridicError(body.detail ?? `Erro ${r.status}. Este edital pode ter sido processado com versão anterior — faça novo upload para habilitar a análise.`);
                  return;
                }
                load();
              }}
              className="btn btn-primary shrink-0"
            >
              Disparar análise jurídica
            </button>
          )}
        </div>
      )}

      {tab === 'juridico' && juridico && (
        <div className="space-y-4">
          <h2 className="font-poppins font-bold text-lg text-slate-900">
            Análise Jurídica
            {juridico.resumo_executivo?.score_conformidade != null && (
              <span className={`ml-3 score-number text-2xl ${
                (juridico.resumo_executivo.score_conformidade ?? 0) >= 70 ? 'text-green-700' :
                (juridico.resumo_executivo.score_conformidade ?? 0) >= 45 ? 'text-blue-600' : 'text-red-600'
              }`}>
                {juridico.resumo_executivo.score_conformidade}
              </span>
            )}
          </h2>

          {/* Resumo executivo */}
          {juridico.resumo_executivo && (
            <div className="card">
              <div className="flex flex-wrap gap-2 mb-3">
                {juridico.resumo_executivo.conformidade_geral && (
                  <span className={`badge ${conform(juridico.resumo_executivo.conformidade_geral)}`}>
                    {juridico.resumo_executivo.conformidade_geral}
                  </span>
                )}
                {juridico.risco_juridico?.nivel_risco && (
                  <span className={`badge ${riskColor(juridico.risco_juridico.nivel_risco)}`}>
                    Risco {juridico.risco_juridico.nivel_risco}
                  </span>
                )}
              </div>
              {(juridico.resumo_executivo.recomendacao ?? juridico.resumo_executivo.recomendacao_go_nogo) && (
                <p className="text-sm text-slate-600 mb-3 leading-relaxed font-medium">
                  {juridico.resumo_executivo.recomendacao ?? juridico.resumo_executivo.recomendacao_go_nogo}
                </p>
              )}
              {(juridico.resumo_executivo.pontos_criticos?.length ?? 0) > 0 && (
                <ul className="space-y-1.5">
                  {juridico.resumo_executivo.pontos_criticos!.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-500">
                      <span className="text-danger shrink-0">●</span><span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Risco jurídico: cláusulas restritivas */}
          {((juridico.risco_juridico?.clausulas_restritivas?.length ?? 0) > 0 ||
            (juridico.risco_juridico?.riscos?.length ?? 0) > 0) && (
            <div className="card">
              <p className="section-title">Cláusulas Restritivas e Riscos</p>
              {(juridico.risco_juridico!.clausulas_restritivas ?? []).map((c, i) => (
                <div key={i} className="gap-item mb-2">
                  <div className="gap-item-title">{c}</div>
                </div>
              ))}
              {(juridico.risco_juridico!.riscos ?? []).map((r, i) => (
                <div key={i} className="flex gap-2 text-sm text-orange-600 mt-1">
                  <span className="shrink-0">⚠</span><span>{r}</span>
                </div>
              ))}
            </div>
          )}

          {/* Documentos protocolo */}
          {(juridico.documentos_protocolo?.length ?? 0) > 0 && (
            <div>
              <p className="section-title px-1 mb-2">Documentos para Protocolar</p>
              <div className="space-y-3">
                {juridico.documentos_protocolo!.map((doc, i) => (
                  <div key={i} className={`section-card ${doc.tipo === 'IMPUGNACAO' ? 'section-card-red' : 'section-card-orange'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`badge ${doc.tipo === 'IMPUGNACAO' ? 'badge-red' : 'badge-orange'}`}>
                        {doc.tipo}
                      </span>
                      {doc.prazo_limite && (
                        <span className="badge badge-gray text-[11px]">Prazo: {doc.prazo_limite}</span>
                      )}
                    </div>
                    <p className="font-medium text-slate-900 text-sm mb-1">{doc.topico}</p>
                    {doc.numero_clausula && (
                      <p className="text-xs text-slate-400 mb-2">Cláusula {doc.numero_clausula}: {doc.clausula_questionada}</p>
                    )}
                    {doc.destinatario && (
                      <p className="text-xs text-slate-400 mb-3">Destinatário: {doc.destinatario}</p>
                    )}
                    {(doc.base_legal?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {doc.base_legal!.map((b, j) => (
                          <span key={j} className="badge badge-blue text-[10px]">{b}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className="copy-box flex-1 max-h-48 overflow-y-auto">{doc.texto_formal}</div>
                      <button
                        onClick={() => copyText(doc.texto_formal, `doc-${i}`)}
                        className="btn btn-ghost btn-sm shrink-0"
                      >
                        {copied === `doc-${i}` ? '✓' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Error banner for juridico 409 ──────────────── */}
      {tab === 'juridico' && juridicError && (
        <div className="alert-warning">{juridicError}</div>
      )}

      {/* ── Comentários (seção fixa, sempre visível) ────── */}
      {tab === 'resumo' && edital.edital_id && (
        <div className="card space-y-4">
          <h2 className="font-poppins font-bold text-base text-slate-900 flex items-center gap-2">
            Comentários
            {(edital.comentarios?.length ?? 0) > 0 && (
              <span className="text-xs font-normal text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                {edital.comentarios!.length}
              </span>
            )}
          </h2>
          <div className="space-y-4">
            {edital.comentarios?.map(c => (
              <div key={c.comentario_id} className="flex gap-3">
                <div className="mt-1 w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <span className="text-blue-700 text-xs font-bold">
                    {(c.autor_email?.split('@')[0]?.[0] ?? '?').toUpperCase()}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <span className="text-slate-600 font-medium">{c.autor_email}</span>
                    <span>{new Date(c.criado_em).toLocaleString('pt-BR')}</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.texto}</p>
                </div>
              </div>
            ))}
            {(edital.comentarios?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-300 py-1">Nenhum comentário ainda.</p>
            )}
          </div>
          <div className="flex gap-3 pt-3 border-t border-slate-200">
            <textarea
              rows={2}
              className="input flex-1 resize-none"
              placeholder="Adicionar comentário…"
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComentario(); }}
            />
            <button
              onClick={postComentario}
              disabled={!comentario.trim() || postingComment}
              className="btn btn-primary self-end disabled:opacity-40"
            >
              {postingComment ? '…' : 'Enviar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Movimentações ───────────────────────────────── */}
      {tab === 'resumo' && (edital.movimentacoes?.length ?? 0) > 0 && (
        <Accordion title="Histórico de movimentações" count={edital.movimentacoes!.length}>
          <div className="space-y-3 pt-2">
            {edital.movimentacoes!.map(m => (
              <div key={m.mov_id} className="timeline-line text-sm text-slate-500">
                <span className="timeline-dot" />
                <div>
                  <span className="text-slate-700">{STAGES[m.fase_origem] ?? m.fase_origem}</span>
                  {' → '}
                  <span className="text-cyan-700">{STAGES[m.fase_destino] ?? m.fase_destino}</span>
                  {m.motivo && <span className="text-slate-400"> · {m.motivo}</span>}
                  <div className="text-xs text-slate-300 mt-0.5">
                    {m.autor_email} · {new Date(m.criado_em).toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Accordion>
      )}
    </div>
  );
}
