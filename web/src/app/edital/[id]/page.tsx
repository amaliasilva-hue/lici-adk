'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────
type Evidencia = {
  requisito: string;
  fonte_tabela: string;
  fonte_id?: string;
  trecho_literal: string;
  tipo_evidencia: 'atestado' | 'contrato' | 'deal_won' | 'certificado' | 'yaml';
  confianca: number;
};

type Gap = {
  requisito: string;
  tipo: string;
  delta_numerico?: number;
  recomendacao: string;
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
  if (s == null) return 'text-white/40';
  if (s >= 70) return 'text-green-accent';
  if (s >= 45) return 'text-primary-light';
  return 'text-danger';
}

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
        <span>{title}{count != null ? <span className="ml-1.5 text-white/40 font-normal">({count})</span> : ''}</span>
        <svg className="w-4 h-4 text-white/35 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

  const kitJur = juridico?.kit_habilitacao;
  const ateRecomendados = kitJur?.atestados_recomendados ?? [];
  const certidoes = kitJur?.certidoes_checklist ?? [];
  const gapHab = kitJur?.gap_habilitacao;

  const atestadoAnalise = juridico?.atestado_analise;

  const hasAny = atestados.length > 0 || contratos.length > 0 || ateRecomendados.length > 0 || gaps.length > 0 || certifics.length > 0;
  if (!hasAny && !gapHab && !atestadoAnalise) return null;

  return (
    <div className="space-y-4">
      <h2 className="font-poppins font-bold text-lg text-white">Habilitação Técnica</h2>

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
            <p className="text-sm text-white/65 leading-relaxed">{atestadoAnalise.fundamentacao}</p>
          )}
          {(atestadoAnalise.alertas?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1">
              {atestadoAnalise.alertas!.map((a, i) => (
                <li key={i} className="text-xs text-orange-300/80 flex gap-1.5">
                  <span>⚠</span><span>{a}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Atestados formais disponíveis */}
      {(atestados.length > 0 || ateRecomendados.length > 0) && (
        <div className="section-card section-card-green">
          <p className="section-title">
            Atestados formais disponíveis
            <span className="ml-2 text-green-accent/70">({Math.max(atestados.length, ateRecomendados.length)})</span>
          </p>
          <p className="text-xs text-white/40 mb-3">Documentos prontos para apresentar como comprovação de capacidade técnica</p>

          {/* Drive files (from legal analysis) */}
          {ateRecomendados.length > 0 && (
            <div className="space-y-0 mb-4">
              {ateRecomendados.map((a, i) => (
                <div key={i} className="evidence-row">
                  <div className="evidence-icon bg-green-accent/15 text-green-accent">✓</div>
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
                    <a
                      href={`https://drive.google.com/file/d/${a.drive_file_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost btn-sm shrink-0"
                    >
                      Drive →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* From commercial analysis evidencias */}
          {atestados.length > 0 && (
            <div className="space-y-0">
              {ateRecomendados.length > 0 && <p className="text-xs text-white/30 mb-2 mt-2">Também encontrados na base de dados:</p>}
              {atestados.map((e, i) => (
                <div key={i} className="evidence-row">
                  <div className="evidence-icon bg-green-accent/15 text-green-accent">✓</div>
                  <div className="evidence-meta">
                    <div className="evidence-source">{e.fonte_id ?? e.requisito}</div>
                    <div className="evidence-excerpt">{e.trecho_literal}</div>
                  </div>
                  <span className="badge badge-green shrink-0">
                    {Math.round(e.confianca * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Contratos sem atestado formal — solicitar emissão */}
      {contratos.length > 0 && (
        <div className="section-card section-card-orange">
          <p className="section-title">
            Contratos sem atestado formal
            <span className="ml-2 text-orange-400/70">({contratos.length})</span>
          </p>
          <div className="alert-warning mb-3">
            <strong>Ação necessária:</strong> Os contratos abaixo comprovam experiência técnica, mas não possuem atestado formal emitido. Solicite ao cliente a emissão do documento para compor o kit de habilitação.
          </div>
          <div className="space-y-0">
            {contratos.map((e, i) => (
              <div key={i} className="contract-row">
                <div className="evidence-icon bg-orange-400/12 text-orange-400 shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="evidence-meta">
                  <div className="contract-row-source">{e.fonte_id ?? `Contrato ${i+1}`}</div>
                  <div className="contract-row-excerpt">{e.trecho_literal}</div>
                  <div className="text-xs text-white/30 mt-0.5">Requisito: {e.requisito}</div>
                </div>
                <span className="badge badge-orange shrink-0">Solicitar</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gaps de habilitação */}
      {gaps.length > 0 && (
        <div className="section-card section-card-red">
          <p className="section-title">
            Gaps de Habilitação
            <span className="ml-2 text-danger/70">({gaps.length})</span>
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
          {gapHab && (
            <div className="mt-3 alert-warning text-sm">{gapHab}</div>
          )}
        </div>
      )}

      {/* Certidões */}
      {certidoes.length > 0 && (
        <div className="section-card">
          <p className="section-title">Certidões Necessárias</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {certidoes.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${c.obrigatorio ? 'bg-primary/20 text-primary-light' : 'bg-white/10 text-white/40'}`}>
                  {c.obrigatorio ? '!' : '○'}
                </span>
                <span className="text-white/80">{c.nome}</span>
                {c.validade_dias && <span className="text-white/30 text-xs">{c.validade_dias}d</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Certificações */}
      {certifics.length > 0 && (
        <div className="section-card section-card-pink">
          <p className="section-title">Certificações ({certifics.length})</p>
          <div className="space-y-0">
            {certifics.map((e, i) => (
              <div key={i} className="evidence-row">
                <div className="evidence-icon bg-pink-accent/15 text-pink-accent text-xs">🏅</div>
                <div className="evidence-meta">
                  <div className="evidence-source">{e.fonte_id ?? `Certificação ${i+1}`}</div>
                  <div className="evidence-excerpt">{e.trecho_literal}</div>
                </div>
              </div>
            ))}
          </div>
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
    <div className="flex items-center justify-center py-24 text-white/40 text-sm gap-3">
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
      <div className="text-sm text-white/35 flex items-center gap-1.5">
        <Link href="/" className="hover:text-white transition-colors">Pipeline</Link>
        <span>/</span>
        <span className="text-white/60">{edital.orgao || id}</span>
      </div>

      {/* ── Header card ────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          {/* Left: info */}
          <div className="flex-1 min-w-0">
            <h1 className="font-poppins font-bold text-2xl text-white leading-tight mb-1">
              {edital.orgao || '—'}
            </h1>
            <p className="text-white/55 text-sm mb-3 leading-relaxed">
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
                <div className="text-xs text-white/30 mt-0.5">score comercial</div>
              </>
            ) : isRunning ? (
              <div className="text-white/30 text-sm mt-2">Analisando…</div>
            ) : (
              <div className="score-number text-white/20">—</div>
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
            <div className="flex flex-wrap gap-4 text-xs text-white/50">
              {juridico.ficha_processo.prazos_calculados.data_limite_impugnacao && (
                <span>
                  <span className="text-danger font-medium">Impugnação até: </span>
                  {juridico.ficha_processo.prazos_calculados.data_limite_impugnacao}
                </span>
              )}
              {juridico.ficha_processo.prazos_calculados.data_limite_esclarecimento && (
                <span>
                  <span className="text-orange-300/80 font-medium">Esclarecimento até: </span>
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

      {/* ── Gestão: stage changer + gates ──────────────── */}
      {edital.edital_id && (
        <div className="card space-y-4">
          <h2 className="font-poppins font-bold text-base text-white">Gestão do Processo</h2>

          {/* Stage changer */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-white/40 mb-1 block uppercase tracking-wide">Mover para fase</label>
              <select value={patchFase} onChange={e => setPatchFase(e.target.value)} className="input w-44">
                <option value="">— selecione —</option>
                {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/40 mb-1 block uppercase tracking-wide">Estado terminal</label>
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
                  <p className="text-sm font-medium text-white/70">
                    Checklist — {STAGES[edital.fase_atual ?? ''] ?? edital.fase_atual}
                  </p>
                  <span className="text-xs text-white/35">{gatesDone}/{gatesTotal}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-white/10 rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: gatesTotal > 0 ? `${(gatesDone/gatesTotal)*100}%` : '0%' }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {edital.gates!.map(gate => (
                    <label key={gate.gate_id} className="flex items-center gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={gate.concluido}
                        onChange={() => toggleGate(gate)}
                        className="w-4 h-4 accent-primary rounded"
                      />
                      <span className={`text-sm ${gate.concluido ? 'line-through text-white/30' : 'text-white/70'} group-hover:text-white/90 transition-colors`}>
                        {gate.label}
                      </span>
                      {gate.concluido_em && (
                        <span className="text-xs text-white/20 ml-auto">
                          {new Date(gate.concluido_em).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Habilitação Técnica & Atestados ────────────── */}
      <AtestadosSection parecer={parecer} juridico={juridico} />

      {/* ── Análise Comercial ───────────────────────────── */}
      {parecer && (
        <div className="space-y-4">
          <h2 className="font-poppins font-bold text-lg text-white">Análise Comercial</h2>

          {/* Estratégia */}
          {parecer.estrategia && (
            <div className="card">
              <p className="section-title">Estratégia</p>
              <p className="text-sm text-white/70 whitespace-pre-line leading-relaxed">{parecer.estrategia}</p>
            </div>
          )}

          {/* Alertas */}
          {(parecer.alertas?.length ?? 0) > 0 && (
            <div className="card">
              <p className="section-title">Alertas ({parecer.alertas!.length})</p>
              <ul className="space-y-2">
                {parecer.alertas!.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm text-white/70">
                    <span className="text-orange-300/80 shrink-0">⚠</span>
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
                    <div className="evidence-icon bg-green-accent/15 text-green-accent text-sm">✓</div>
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
      {juridico && (
        <div className="space-y-4">
          <h2 className="font-poppins font-bold text-lg text-white">
            Análise Jurídica
            {juridico.resumo_executivo?.score_conformidade != null && (
              <span className={`ml-3 score-number text-2xl ${
                (juridico.resumo_executivo.score_conformidade ?? 0) >= 70 ? 'text-green-accent' :
                (juridico.resumo_executivo.score_conformidade ?? 0) >= 45 ? 'text-primary-light' : 'text-danger'
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
                <p className="text-sm text-white/75 mb-3 leading-relaxed font-medium">
                  {juridico.resumo_executivo.recomendacao ?? juridico.resumo_executivo.recomendacao_go_nogo}
                </p>
              )}
              {(juridico.resumo_executivo.pontos_criticos?.length ?? 0) > 0 && (
                <ul className="space-y-1.5">
                  {juridico.resumo_executivo.pontos_criticos!.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-white/65">
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
                <div key={i} className="flex gap-2 text-sm text-orange-300/75 mt-1">
                  <span className="shrink-0">⚠</span><span>{r}</span>
                </div>
              ))}
            </div>
          )}

          {/* Documentos protocolo */}
          {(juridico.documentos_protocolo?.length ?? 0) > 0 && (
            <div>
              <p className="section-title text-white/50 px-1 mb-2">Documentos para Protocolar</p>
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
                    <p className="font-medium text-white/90 text-sm mb-1">{doc.topico}</p>
                    {doc.numero_clausula && (
                      <p className="text-xs text-white/40 mb-2">Cláusula {doc.numero_clausula}: {doc.clausula_questionada}</p>
                    )}
                    {doc.destinatario && (
                      <p className="text-xs text-white/40 mb-3">Destinatário: {doc.destinatario}</p>
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

      {/* ── Comentários ─────────────────────────────────── */}
      {edital.edital_id && (
        <Accordion title="Comentários" count={edital.comentarios?.length ?? 0}>
          <div className="space-y-4 pt-2">
            {edital.comentarios?.map(c => (
              <div key={c.comentario_id} className="timeline-line">
                <span className="timeline-dot mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-white/35 mb-1">
                    <span className="text-white/55 font-medium">{c.autor_email}</span>
                    <span>{new Date(c.criado_em).toLocaleString('pt-BR')}</span>
                  </div>
                  <p className="text-sm text-white/75 whitespace-pre-wrap">{c.texto}</p>
                </div>
              </div>
            ))}
            {(edital.comentarios?.length ?? 0) === 0 && (
              <p className="text-sm text-white/30 py-2">Nenhum comentário ainda.</p>
            )}
            <div className="flex gap-3 mt-4 pt-3 border-t border-white/8">
              <textarea
                rows={2}
                className="input flex-1 resize-none"
                placeholder="Adicionar comentário…"
                value={comentario}
                onChange={e => setComentario(e.target.value)}
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
        </Accordion>
      )}

      {/* ── Movimentações ───────────────────────────────── */}
      {(edital.movimentacoes?.length ?? 0) > 0 && (
        <Accordion title="Histórico de movimentações" count={edital.movimentacoes!.length}>
          <div className="space-y-3 pt-2">
            {edital.movimentacoes!.map(m => (
              <div key={m.mov_id} className="timeline-line text-sm text-white/55">
                <span className="timeline-dot" />
                <div>
                  <span className="text-white/75">{STAGES[m.fase_origem] ?? m.fase_origem}</span>
                  {' → '}
                  <span className="text-primary-light">{STAGES[m.fase_destino] ?? m.fase_destino}</span>
                  {m.motivo && <span className="text-white/35"> · {m.motivo}</span>}
                  <div className="text-xs text-white/25 mt-0.5">
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
  classificacao?: string;
  risco?: string;
  prioridade?: number;
  criado_em?: string;
  // legacy in-memory fields
  status?: string;
  result?: any;
  relatorio_juridico?: any;
  job_juridico_status?: string;
  current_agent?: string;
  edital_filename?: string;
  // Fase 6 sub-objects
  comentarios?: Comentario[];
  gates?: Gate[];
  movimentacoes?: Mov[];
};

type Comentario = {
  comentario_id: string;
  autor_email: string;
  texto: string;
  criado_em: string;
};

type Gate = {
  gate_id: string;
  stage: string;
  gate_key: string;
  label: string;
  concluido: boolean;
  concluido_por?: string;
  concluido_em?: string;
};

type Mov = {
  mov_id: string;
  fase_origem: string;
  fase_destino: string;
  autor_email: string;
  motivo?: string;
  criado_em: string;
};

const STAGES: Record<string, string> = {
  identificacao: 'Identificação', analise: 'Análise', pre_disputa: 'Pré-disputa',
  proposta: 'Proposta', disputa: 'Disputa', habilitacao: 'Habilitação',
  recursos: 'Recursos', homologado: 'Homologado',
};

const TERMINAIS = ['ganho', 'perdido', 'inabilitado', 'revogado', 'nao_participamos'];

// ─── Score badge ──────────────────────────────────────────
function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return <span className="text-white/30">—</span>;
  const cls = score >= 70 ? 'badge-green' : score >= 45 ? 'badge-blue' : 'badge-red';
  return <span className={`badge ${cls} text-lg px-3 py-1`}>{score}%</span>;
}

// ─── Accordion section ────────────────────────────────────
function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="card">
      <summary className="font-poppins font-semibold text-white py-1">
        {title}
        <svg className="w-4 h-4 text-white/40 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
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

  // Polling while analysis is running
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
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto: comentario, autor_email: 'usuario@xertica.com' }),
      });
      setComentario('');
      await load();
    } finally {
      setPostingComment(false);
    }
  }

  async function toggleGate(gate: Gate) {
    await fetch(`/api/proxy/editais/${id}/gates/${gate.gate_key}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
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
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setPatchFase('');
      setPatchTerminal('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-white/40 text-sm py-20 text-center">Carregando…</div>;
  if (error) return <div className="card border-danger/50 text-danger">{error}</div>;
  if (!edital) return null;

  const parecer = edital.result;
  const juridico = edital.relatorio_juridico;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-white/40">
        <Link href="/" className="hover:text-white">Pipeline</Link>
        <span className="mx-2">/</span>
        <span className="text-white/70">{edital.orgao || id}</span>
      </div>

      {/* Header card */}
      <div className="card flex flex-col sm:flex-row gap-6">
        <div className="flex-1 space-y-1">
          <h1 className="font-poppins font-bold text-2xl text-white leading-tight">
            {edital.orgao || '—'}
          </h1>
          <p className="text-white/60 text-sm">{edital.objeto || edital.edital_filename || '—'}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {edital.uf && <span className="badge badge-gray">{edital.uf}</span>}
            {edital.uasg && <span className="badge badge-blue">UASG {edital.uasg}</span>}
            {edital.numero_pregao && <span className="badge badge-gray">{edital.numero_pregao}</span>}
            {edital.portal && <span className="badge badge-gray">{edital.portal}</span>}
            {edital.fase_atual && (
              <span className="badge badge-blue">{STAGES[edital.fase_atual] ?? edital.fase_atual}</span>
            )}
            {edital.estado_terminal && (
              <span className={`badge ${edital.estado_terminal === 'ganho' ? 'badge-green' : 'badge-red'}`}>
                {edital.estado_terminal}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <ScoreBadge score={edital.score_comercial ?? parecer?.score_aderencia} />
          {edital.valor_estimado && (
            <span className="text-white/50 text-sm">
              R$ {edital.valor_estimado.toLocaleString('pt-BR')}
            </span>
          )}
          {edital.data_encerramento && (
            <span className="text-white/40 text-xs">Encerramento: {edital.data_encerramento}</span>
          )}
        </div>
      </div>

      {/* Stage changer */}
      {edital.edital_id && (
        <div className="card flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Mover para fase</label>
            <select
              value={patchFase}
              onChange={(e) => setPatchFase(e.target.value)}
              className="input w-40"
            >
              <option value="">— selecione —</option>
              {Object.entries(STAGES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Estado terminal</label>
            <select
              value={patchTerminal}
              onChange={(e) => setPatchTerminal(e.target.value)}
              className="input w-44"
            >
              <option value="">— nenhum —</option>
              {TERMINAIS.map((t) => <option key={t} value={t}>{t}</option>)}
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
      )}

      {/* Commercial analysis */}
      {parecer && (
        <Accordion title="Análise Comercial">
          <div className="space-y-4 text-sm text-white/70">
            {parecer.bloqueio_camada_1 && (
              <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger">
                <strong>Bloqueio camada 1:</strong> {parecer.bloqueio_camada_1}
              </div>
            )}
            <p className="whitespace-pre-line">{parecer.estrategia}</p>
            {parecer.alertas?.length > 0 && (
              <div>
                <h4 className="text-white/50 font-medium mb-2">Alertas</h4>
                <ul className="list-disc pl-5 space-y-1">
                  {parecer.alertas.map((a: string, i: number) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            {parecer.gaps?.length > 0 && (
              <div>
                <h4 className="text-white/50 font-medium mb-2">Gaps</h4>
                <div className="space-y-2">
                  {parecer.gaps.map((g: any, i: number) => (
                    <div key={i} className="p-2 rounded-lg bg-white/5">
                      <p className="font-medium text-white/80">{g.requisito}</p>
                      <p className="text-xs text-white/50">{g.tipo} · {g.recomendacao}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Accordion>
      )}

      {/* Legal analysis */}
      {juridico && (
        <>
          {juridico.resumo_executivo && (
            <Accordion title={`Análise Jurídica — Score ${juridico.resumo_executivo.score_conformidade ?? '—'}`}>
              <div className="text-sm text-white/70 space-y-3">
                <div className="flex gap-3 flex-wrap">
                  <span className="badge badge-blue">
                    Risco: {juridico.risco_juridico?.nivel_risco ?? '—'}
                  </span>
                  <span className="badge badge-gray">
                    Modalidade: {juridico.resumo_executivo.modalidade ?? '—'}
                  </span>
                </div>
                <p>{juridico.resumo_executivo.recomendacao_go_nogo}</p>
                {juridico.resumo_executivo.pontos_criticos?.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1">
                    {juridico.resumo_executivo.pontos_criticos.map((p: string, i: number) => <li key={i}>{p}</li>)}
                  </ul>
                )}
              </div>
            </Accordion>
          )}
          {juridico.requisitos_habilitacao && (
            <Accordion title="Requisitos de Habilitação">
              <div className="space-y-2 text-sm text-white/70">
                {Object.entries(juridico.requisitos_habilitacao).map(([k, v]: any) => (
                  <div key={k} className="flex gap-2">
                    <span className={`flex-shrink-0 text-xs ${v ? 'text-green-accent' : 'text-white/30'}`}>
                      {v ? '✓' : '○'}
                    </span>
                    <span>{k.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </Accordion>
          )}
        </>
      )}

      {/* Gates checklist */}
      {edital.gates && edital.gates.length > 0 && (
        <Accordion title={`Gates — ${edital.gates.filter((g) => g.concluido).length}/${edital.gates.length} concluídos`}>
          <div className="space-y-2">
            {edital.gates.map((gate) => (
              <label key={gate.gate_id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={gate.concluido}
                  onChange={() => toggleGate(gate)}
                  className="w-4 h-4 accent-primary"
                />
                <span className={`text-sm ${gate.concluido ? 'line-through text-white/30' : 'text-white/70'}`}>
                  {gate.label}
                </span>
                {gate.concluido_em && (
                  <span className="text-xs text-white/20 ml-auto">
                    {new Date(gate.concluido_em).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </label>
            ))}
          </div>
        </Accordion>
      )}

      {/* Comments */}
      {edital.edital_id && (
        <Accordion title={`Comentários (${edital.comentarios?.length ?? 0})`}>
          <div className="space-y-4">
            {edital.comentarios?.map((c) => (
              <div key={c.comentario_id} className="flex gap-3">
                <span className="timeline-dot" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-white/40 mb-1">
                    <span className="text-white/60 font-medium">{c.autor_email}</span>
                    <span>{new Date(c.criado_em).toLocaleString('pt-BR')}</span>
                  </div>
                  <p className="text-sm text-white/80 whitespace-pre-wrap">{c.texto}</p>
                </div>
              </div>
            ))}
            <div className="flex gap-3 mt-4">
              <textarea
                rows={2}
                className="input flex-1 resize-none"
                placeholder="Adicionar comentário…"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
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
        </Accordion>
      )}

      {/* Timeline */}
      {edital.movimentacoes && edital.movimentacoes.length > 0 && (
        <Accordion title="Histórico de movimentações">
          <div className="space-y-3">
            {edital.movimentacoes.map((m) => (
              <div key={m.mov_id} className="flex gap-3 text-sm text-white/60">
                <span className="timeline-dot" />
                <div>
                  <span className="text-white/80">
                    {STAGES[m.fase_origem] ?? m.fase_origem}
                  </span>
                  {' → '}
                  <span className="text-primary-light">
                    {STAGES[m.fase_destino] ?? m.fase_destino}
                  </span>
                  {m.motivo && <span className="text-white/40"> · {m.motivo}</span>}
                  <div className="text-xs text-white/30">
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
