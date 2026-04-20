'use client';
import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const UF_LIST = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

type UploadStage = 'idle' | 'uploading' | 'queued' | 'running' | 'done' | 'failed';

const AGENT_LABELS: Record<string, string> = {
  extrator:    'Extraindo dados do edital…',
  qualificador:'Qualificando evidências no BigQuery…',
  analista:    'Analisando aderência comercial…',
};

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile]           = useState<File | null>(null);
  const [dragging, setDragging]   = useState(false);
  const [orgao, setOrgao]         = useState('');
  const [uf, setUf]               = useState('');
  const [vendedor, setVendedor]   = useState('');
  const [driveFolder, setDriveFolder] = useState('');
  const [stage, setStage]         = useState<UploadStage>('idle');
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [analysisId, setAnalysisId]     = useState<string | null>(null);
  const [pgEditalId, setPgEditalId]     = useState<string | null>(null);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [score, setScore]               = useState<number | null>(null);
  const [resultStatus, setResultStatus] = useState<string | null>(null);

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith('.pdf')) setFile(f);
  };

  const poll = useCallback(async (id: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r = await fetch(`/api/proxy/editais/${id}`);
        if (!r.ok) continue;
        const data = await r.json();
        if (data.status === 'running') { setCurrentAgent(data.current_agent ?? null); continue; }
        if (data.status === 'queued') continue;
        if (data.status === 'failed') { setStage('failed'); setErrorMsg(data.error ?? 'Falha no pipeline'); return; }
        // done — pega o edital_id do Postgres
        const eid = data.pg_edital_id || data.edital_id || id;
        setPgEditalId(eid);
        setScore(data.score_comercial ?? data.result?.score_aderencia ?? null);
        setResultStatus(data.result?.status ?? null);
        setStage('done');
        return;
      } catch { continue; }
    }
    setStage('failed');
    setErrorMsg('Tempo limite excedido. Verifique o pipeline.');
  }, []);

  async function submit() {
    if (!file) return;
    setStage('uploading'); setErrorMsg(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch('/api/proxy/analyze', { method: 'POST', body: form });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.detail ?? `HTTP ${r.status}`); }
      const data = await r.json();
      setAnalysisId(data.analysis_id);
      setStage('running');
      await poll(data.analysis_id);
    } catch (e: any) { setStage('failed'); setErrorMsg(e.message ?? 'Erro desconhecido'); }
  }

  function scoreColor(s: number | null) {
    if (s == null) return 'text-slate-400';
    if (s >= 70) return 'text-green-700';
    if (s >= 45) return 'text-cyan-700';
    return 'text-danger';
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-sm text-slate-400">
        <Link href="/" className="hover:text-slate-900">Pipeline</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-600">Novo edital</span>
      </div>

      <h1 className="font-poppins font-bold text-2xl text-slate-900">Upload de Edital</h1>

      {/* Drop zone */}
      <div
        onClick={() => stage === 'idle' && inputRef.current?.click()}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        className={[
          'rounded-2xl border-2 border-dashed p-10 text-center transition-all',
          dragging ? 'border-primary bg-blue-50' : 'border-slate-300 hover:border-slate-400',
          file ? 'border-green-accent/40 bg-green-500/5' : '',
          stage !== 'idle' ? 'pointer-events-none opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        {file ? (
          <div className="space-y-1">
            <p className="text-green-700 font-semibold text-lg">{file.name}</p>
            <p className="text-slate-400 text-sm">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            {stage === 'idle' && (
              <button onClick={e => { e.stopPropagation(); setFile(null); }} className="text-xs text-slate-300 hover:text-danger mt-2">
                remover
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <svg className="w-10 h-10 text-slate-200 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-slate-400">Arraste o PDF aqui ou <span className="text-cyan-700">clique para selecionar</span></p>
            <p className="text-slate-300 text-xs">Apenas PDF · máx. 30 MB</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
      </div>

      {/* Metadados opcionais */}
      {stage === 'idle' && (
        <div className="card space-y-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Metadados opcionais</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Órgão</label>
              <input type="text" value={orgao} onChange={e => setOrgao(e.target.value)}
                placeholder="Ex: PRODESP" className="input w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">UF</label>
              <select value={uf} onChange={e => setUf(e.target.value)} className="input w-full">
                <option value="">— selecione —</option>
                {UF_LIST.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Vendedor (email)</label>
              <input type="email" value={vendedor} onChange={e => setVendedor(e.target.value)}
                placeholder="vendedor@xertica.com" className="input w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Drive Folder ID (opcional)</label>
              <input type="text" value={driveFolder} onChange={e => setDriveFolder(e.target.value)}
                placeholder="1BxiM..." className="input w-full" />
            </div>
          </div>
        </div>
      )}

      {/* Progresso */}
      {(stage === 'uploading' || stage === 'queued' || stage === 'running') && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 animate-spin text-cyan-700 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <div>
              <p className="text-slate-900 font-medium text-sm">
                {stage === 'uploading' && 'Enviando PDF…'}
                {stage === 'queued'    && 'Na fila — aguardando…'}
                {stage === 'running'   && (AGENT_LABELS[currentAgent ?? ''] ?? 'Analisando…')}
              </p>
              {analysisId && <p className="text-slate-300 text-xs font-mono mt-0.5">{analysisId}</p>}
            </div>
          </div>
          <div className="flex gap-1.5">
            {['Extração', 'Qualificação', 'Análise'].map((label, i) => {
              const isDone = (i === 0 && !!currentAgent && currentAgent !== 'extrator') ||
                             (i === 1 && (currentAgent === 'analista' || currentAgent === 'persistor')) ||
                             false;
              const isActive = (i === 0 && (stage === 'queued' || currentAgent === 'extrator')) ||
                               (i === 1 && currentAgent === 'qualificador') ||
                               (i === 2 && currentAgent === 'analista');
              return (
                <div key={label} className="flex-1 space-y-1">
                  <div className={`h-1.5 rounded-full transition-colors ${isDone ? 'bg-green-500' : isActive ? 'bg-cyan-600' : 'bg-slate-100'}`} />
                  <p className={`text-[10px] text-center ${isActive ? 'text-slate-500' : 'text-slate-300'}`}>{label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resultado */}
      {stage === 'done' && (
        <div className="section-card section-card-green space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-green-700 text-2xl">✓</span>
            <p className="text-slate-900 font-semibold">Análise concluída</p>
          </div>
          {(score != null || resultStatus) && (
            <div className="flex gap-6 items-center">
              {score != null && (
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Score</p>
                  <p className={`text-4xl font-bold font-poppins score-number ${scoreColor(score)}`}>{score}%</p>
                </div>
              )}
              {resultStatus && (
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Status</p>
                  <p className="text-slate-900 font-semibold">{resultStatus}</p>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            {pgEditalId && (
              <button onClick={() => router.push(`/edital/${pgEditalId}`)} className="btn btn-primary">
                Ver análise completa →
              </button>
            )}
            <button onClick={() => router.push('/')} className="btn btn-ghost">Voltar ao pipeline</button>
          </div>
        </div>
      )}

      {/* Erro */}
      {stage === 'failed' && (
        <div className="alert-danger rounded-xl p-4 space-y-3">
          <p className="font-semibold text-danger">Falha na análise</p>
          {errorMsg && <p className="text-sm opacity-80 text-slate-600">{errorMsg}</p>}
          <button onClick={() => { setStage('idle'); setErrorMsg(null); }} className="btn btn-sm btn-ghost">
            Tentar novamente
          </button>
        </div>
      )}

      {/* CTA */}
      {stage === 'idle' && (
        <div className="flex justify-end gap-3">
          <Link href="/" className="btn btn-ghost">Cancelar</Link>
          <button onClick={submit} disabled={!file} className="btn btn-primary disabled:opacity-40">
            Analisar edital
          </button>
        </div>
      )}
    </div>
  );
}
