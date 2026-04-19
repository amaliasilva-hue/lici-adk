'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────
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
