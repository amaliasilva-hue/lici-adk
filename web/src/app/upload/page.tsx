'use client';
import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const UF_LIST = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

const SA_EMAIL =
  process.env.NEXT_PUBLIC_LICI_SA_EMAIL ??
  'lici-adk-sa@operaciones-br.iam.gserviceaccount.com';

type AnalysisStage = 'idle' | 'uploading' | 'queued' | 'running' | 'done' | 'failed';
type Tab = 'pdf' | 'drive' | 'folder' | 'url';

const AGENT_LABELS: Record<string, string> = {
  extrator:    'Extraindo dados do edital…',
  qualificador:'Qualificando evidências no BigQuery…',
  analista:    'Analisando aderência comercial…',
};

// SA Email callout (shown on Drive and Pasta tabs)
function SACallout({ hidden, onHide }: { hidden: boolean; onHide: () => void }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (hidden) return (
    <button onClick={onHide} className="text-xs text-slate-400 hover:text-slate-500 transition-colors mb-3">
      Mostrar dica de compartilhamento
    </button>
  );
  return (
    <div className="mb-5 rounded-2xl overflow-hidden" style={{
      background: 'rgba(0,190,255,0.04)',
      border: '1px solid rgba(0,190,255,0.25)',
      boxShadow: '0 0 24px rgba(0,190,255,0.06)',
    }}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-lg mt-0.5 flex-shrink-0">🛈</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white mb-1">Antes de importar do Google Drive</p>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              Compartilhe o arquivo (ou pasta) com a conta de serviço abaixo — basta acesso de leitura.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 text-xs font-mono text-[#047EA9] bg-slate-100 rounded-lg px-3 py-2 truncate border border-slate-100">
                {SA_EMAIL}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(SA_EMAIL);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                title="Copiar email"
                className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: copied ? 'rgba(192,255,125,0.15)' : 'rgba(0,190,255,0.1)',
                  border: `1px solid ${copied ? 'rgba(192,255,125,0.3)' : 'rgba(0,190,255,0.25)'}`,
                  color: copied ? '#C0FF7D' : '#00BEFF',
                }}
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-600 transition-colors flex items-center gap-1"
            >
              <span>{expanded ? '▾' : '▸'}</span>
              Como compartilhar (3 passos)
            </button>

            {expanded && (
              <ol className="mt-2 space-y-1.5 text-xs text-slate-500 leading-relaxed list-decimal list-inside">
                <li>Abra o arquivo ou pasta no Google Drive.</li>
                <li>Clique em <strong className="text-slate-700">Compartilhar</strong> (canto superior direito).</li>
                <li>Cole o email acima e selecione <strong className="text-slate-700">Leitor</strong>. Pronto.</li>
              </ol>
            )}
          </div>
          <button
            type="button"
            onClick={onHide}
            className="flex-shrink-0 text-xs text-slate-400 hover:text-slate-500 mt-0.5"
          >
            Ocultar
          </button>
        </div>
      </div>
    </div>
  );
}

// Shared progress widget
function ProgressWidget({
  stage, currentAgent, analysisId,
}: { stage: AnalysisStage; currentAgent: string | null; analysisId: string | null }) {
  if (!['uploading', 'queued', 'running'].includes(stage)) return null;
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <svg className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: 'var(--x-cyan)' }} fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        <div>
          <p className="text-white font-medium text-sm">
            {stage === 'uploading' && 'Enviando PDF…'}
            {stage === 'queued'    && 'Na fila — aguardando…'}
            {stage === 'running'   && (
              <span className="font-mono" style={{ color: 'var(--x-cyan)' }}>
                {AGENT_LABELS[currentAgent ?? ''] ?? 'Analisando…'}
              </span>
            )}
          </p>
          {analysisId && <p className="text-slate-400 text-xs font-mono mt-0.5">{analysisId}</p>}
        </div>
      </div>
      <div className="flex gap-1.5">
        {['Extração', 'Qualificação', 'Análise'].map((label, i) => {
          const isDone = (i === 0 && !!currentAgent && currentAgent !== 'extrator') ||
                         (i === 1 && (currentAgent === 'analista' || currentAgent === 'persistor'));
          const isActive = (i === 0 && (stage === 'queued' || currentAgent === 'extrator')) ||
                           (i === 1 && currentAgent === 'qualificador') ||
                           (i === 2 && currentAgent === 'analista');
          return (
            <div key={label} className="flex-1 space-y-1">
              <div className={`h-1.5 rounded-full transition-all duration-300 ${
                isDone ? 'bg-[var(--color-success)]' : isActive ? 'bg-[var(--x-cyan)] anim-scale' : 'bg-slate-100'
              }`} />
              <p className={`text-[10px] text-center font-medium ${
                isActive ? 'text-[var(--x-cyan)]' : isDone ? 'text-[var(--color-success-text)]' : 'text-slate-400'
              }`}>{label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------ Tab: PDF upload ------------------
function TabPDF() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [orgao, setOrgao] = useState('');
  const [uf, setUf] = useState('');
  const [vendedor, setVendedor] = useState('');
  const [stage, setStage] = useState<AnalysisStage>('idle');
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [pgEditalId, setPgEditalId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [resultStatus, setResultStatus] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);

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
        const eid = data.pg_edital_id || data.edital_id || id;
        setPgEditalId(eid);
        setScore(data.score_comercial ?? data.result?.score_aderencia ?? null);
        setResultStatus(data.result?.status ?? null);
        setStage('done');
        return;
      } catch { continue; }
    }
    setStage('failed'); setErrorMsg('Tempo limite excedido.');
  }, []);

  async function submit() {
    if (!file) return;
    setStage('uploading'); setErrorMsg(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch('/api/proxy/analyze', { method: 'POST', body: form });
      if (!r.ok) { const err = await r.json().catch(() => ({})); const msg = r.status === 413 ? (err.detail ?? 'PDF excede o limite de 30 MB') : (err.detail ?? `HTTP ${r.status}`); throw new Error(msg); }
      const data = await r.json();
      if (data.status === 'already_exists') {
        router.push(`/edital/${data.analysis_id}`); return;
      }
      setAnalysisId(data.analysis_id);
      setStage('running');
      await poll(data.analysis_id);
    } catch (e: any) { setStage('failed'); setErrorMsg(e.message ?? 'Erro desconhecido'); }
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onClick={() => stage === 'idle' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f?.name.toLowerCase().endsWith('.pdf')) setFile(f); }}
        className={`dropzone p-10 text-center ${dragging ? 'dropzone-active' : ''} ${file ? 'border-green-500/30 bg-green-500/5' : ''} ${stage !== 'idle' ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
      >
        {file ? (
          <div className="space-y-1">
            <p className="font-semibold text-lg" style={{ color: 'var(--x-green)' }}>{file.name}</p>
            <p className="text-slate-500 text-sm">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            {stage === 'idle' && (
              <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-xs text-slate-400 hover:text-[#B91C1C] mt-2">
                remover
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: 'rgba(0,190,255,0.06)', border: '1px solid rgba(0,190,255,0.15)' }}>
              📄
            </div>
            <p className="text-slate-500">Arraste o PDF aqui ou <span style={{ color: 'var(--x-cyan)' }}>clique para selecionar</span></p>
            <p className="text-slate-400 text-xs">Apenas PDF · máx. 30 MB</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
      </div>

      {/* Advanced metadata toggle */}
      {stage === 'idle' && (
        <div>
          <button
            type="button"
            onClick={() => setShowMeta((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-500 transition-colors flex items-center gap-1"
          >
            <span>{showMeta ? '▾' : '▸'}</span> Avançado (órgão, UF, vendedor)
          </button>
          {showMeta && (
            <div className="mt-3 card grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Órgão</label>
                <input type="text" value={orgao} onChange={(e) => setOrgao(e.target.value)} placeholder="Ex: PRODESP" className="input w-full" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">UF</label>
                <select value={uf} onChange={(e) => setUf(e.target.value)} className="input w-full">
                  <option value="">— selecione —</option>
                  {UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Vendedor (email)</label>
                <input type="email" value={vendedor} onChange={(e) => setVendedor(e.target.value)} placeholder="vendedor@xertica.com" className="input w-full" />
              </div>
            </div>
          )}
        </div>
      )}

      <ProgressWidget stage={stage} currentAgent={currentAgent} analysisId={analysisId} />
      <ResultWidget stage={stage} score={score} resultStatus={resultStatus} pgEditalId={pgEditalId}
        onRetry={() => { setStage('idle'); setErrorMsg(null); }} errorMsg={errorMsg} router={router} />

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

// ------------------ Tab: Google Drive single file ------------------
function TabDrive() {
  const router = useRouter();
  const [driveInput, setDriveInput] = useState('');
  const [orgao, setOrgao] = useState('');
  const [uf, setUf] = useState('');
  const [vendedor, setVendedor] = useState('');
  const [stage, setStage] = useState<AnalysisStage>('idle');
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [pgEditalId, setPgEditalId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [resultStatus, setResultStatus] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [calloutHidden, setCalloutHidden] = useState(false);

  function extractFileId(input: string): string {
    const m = input.match(/\/file\/d\/([^/?\s]+)/);
    if (m) return m[1];
    // Just an ID
    if (/^[A-Za-z0-9_-]{20,}$/.test(input.trim())) return input.trim();
    return input.trim();
  }

  const poll = useCallback(async (id: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r = await fetch(`/api/proxy/editais/${id}`);
        if (!r.ok) continue;
        const data = await r.json();
        if (data.status === 'running') { setCurrentAgent(data.current_agent ?? null); continue; }
        if (data.status === 'queued') continue;
        if (data.status === 'failed') { setStage('failed'); setErrorMsg(data.error ?? 'Falha'); return; }
        const eid = data.pg_edital_id || data.edital_id || id;
        setPgEditalId(eid);
        setScore(data.score_comercial ?? data.result?.score_aderencia ?? null);
        setResultStatus(data.result?.status ?? null);
        setStage('done');
        return;
      } catch { continue; }
    }
    setStage('failed'); setErrorMsg('Tempo limite excedido.');
  }, []);

  async function submit() {
    const fileId = extractFileId(driveInput);
    if (!fileId) return;
    setStage('uploading'); setErrorMsg(null);
    try {
      const r = await fetch('/api/proxy/analyze/from-drive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, orgao: orgao || undefined, uf: uf || undefined, vendedor_email: vendedor || undefined }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const detail = err.detail ?? `HTTP ${r.status}`;
        if (r.status === 404) setCalloutHidden(false); // reopen callout on access error
        throw new Error(detail);
      }
      const data = await r.json();
      if (data.status === 'already_exists') { router.push(`/edital/${data.analysis_id}`); return; }
      setAnalysisId(data.analysis_id);
      setStage('running');
      await poll(data.analysis_id);
    } catch (e: any) { setStage('failed'); setErrorMsg(e.message ?? 'Erro desconhecido'); }
  }

  return (
    <div className="space-y-4">
      <SACallout hidden={calloutHidden} onHide={() => setCalloutHidden((v) => !v)} />

      <div>
        <label className="text-sm text-slate-600 mb-2 block font-medium">URL ou File ID do Google Drive</label>
        <input
          type="text"
          value={driveInput}
          onChange={(e) => setDriveInput(e.target.value)}
          placeholder="https://drive.google.com/file/d/1AbC…/view  ou  1AbCdeF…"
          className="input w-full"
          disabled={stage !== 'idle'}
        />
        <p className="text-xs text-slate-400 mt-1">Cole a URL de compartilhamento ou o ID do arquivo.</p>
      </div>

      <div>
        <button type="button" onClick={() => setShowMeta((v) => !v)} className="text-xs text-slate-400 hover:text-slate-500 transition-colors flex items-center gap-1">
          <span>{showMeta ? '▾' : '▸'}</span> Avançado (órgão, UF, vendedor)
        </button>
        {showMeta && (
          <div className="mt-3 card grid grid-cols-2 gap-4">
            <div><label className="text-xs text-slate-500 mb-1 block">Órgão</label><input type="text" value={orgao} onChange={(e) => setOrgao(e.target.value)} placeholder="PRODESP" className="input w-full" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">UF</label><select value={uf} onChange={(e) => setUf(e.target.value)} className="input w-full"><option value="">— selecione —</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">Vendedor</label><input type="email" value={vendedor} onChange={(e) => setVendedor(e.target.value)} placeholder="vendedor@xertica.com" className="input w-full" /></div>
          </div>
        )}
      </div>

      <ProgressWidget stage={stage} currentAgent={currentAgent} analysisId={analysisId} />
      <ResultWidget stage={stage} score={score} resultStatus={resultStatus} pgEditalId={pgEditalId}
        onRetry={() => { setStage('idle'); setErrorMsg(null); }} errorMsg={errorMsg} router={router} />

      {stage === 'idle' && (
        <div className="flex justify-end gap-3">
          <Link href="/" className="btn btn-ghost">Cancelar</Link>
          <button onClick={submit} disabled={!driveInput.trim()} className="btn btn-primary disabled:opacity-40">
            Importar do Drive →
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------ Tab: Drive folder bulk import ------------------
function TabFolder() {
  const router = useRouter();
  const [folderInput, setFolderInput] = useState('');
  const [maxFiles, setMaxFiles] = useState(10);
  const [orgao, setOrgao] = useState('');
  const [uf, setUf] = useState('');
  const [vendedor, setVendedor] = useState('');
  const [showMeta, setShowMeta] = useState(false);
  const [calloutHidden, setCalloutHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<{ file_id: string; filename: string; analysis_id: string; status: string }[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function extractFolderId(input: string): string {
    const m = input.match(/\/folders\/([^/?&\s]+)/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{20,}$/.test(input.trim())) return input.trim();
    return input.trim();
  }

  async function submit() {
    const folderId = extractFolderId(folderInput);
    if (!folderId) return;
    setLoading(true); setErrorMsg(null); setJobs([]);
    try {
      const r = await fetch('/api/proxy/analyze/from-drive-folder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          folder_id: folderId,
          max_files: maxFiles,
          orgao: orgao || undefined,
          uf: uf || undefined,
          vendedor_email: vendedor || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (r.status === 404) setCalloutHidden(false);
        throw new Error(err.detail ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      setJobs(data.analysis_ids ?? []);
      setDone(true);
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <SACallout hidden={calloutHidden} onHide={() => setCalloutHidden((v) => !v)} />

      <div>
        <label className="text-sm text-slate-600 mb-2 block font-medium">URL ou Folder ID do Google Drive</label>
        <input
          type="text"
          value={folderInput}
          onChange={(e) => setFolderInput(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/1XyZ…  ou  1XyZ…"
          className="input w-full"
          disabled={loading || done}
        />
      </div>

      <div>
        <label className="text-sm text-slate-600 mb-2 block font-medium">
          Máximo de arquivos: <span style={{ color: 'var(--x-cyan)' }}>{maxFiles}</span>
        </label>
        <input
          type="range" min={1} max={30} value={maxFiles}
          onChange={(e) => setMaxFiles(Number(e.target.value))}
          className="w-full accent-cyan-500"
          disabled={loading || done}
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1"><span>1</span><span>30</span></div>
      </div>

      <div>
        <button type="button" onClick={() => setShowMeta((v) => !v)} className="text-xs text-slate-400 hover:text-slate-500 transition-colors flex items-center gap-1">
          <span>{showMeta ? '▾' : '▸'}</span> Avançado (órgão, UF, vendedor)
        </button>
        {showMeta && (
          <div className="mt-3 card grid grid-cols-2 gap-4">
            <div><label className="text-xs text-slate-500 mb-1 block">Órgão</label><input type="text" value={orgao} onChange={(e) => setOrgao(e.target.value)} placeholder="PRODESP" className="input w-full" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">UF</label><select value={uf} onChange={(e) => setUf(e.target.value)} className="input w-full"><option value="">— selecione —</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">Vendedor</label><input type="email" value={vendedor} onChange={(e) => setVendedor(e.target.value)} placeholder="vendedor@xertica.com" className="input w-full" /></div>
          </div>
        )}
      </div>

      {loading && (
        <div className="card flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: 'var(--x-cyan)' }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <span className="text-sm text-slate-600">Enfileirando PDFs da pasta…</span>
        </div>
      )}

      {done && jobs.length > 0 && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--x-green)' }}>
            ✓ {jobs.length} arquivo(s) enfileirado(s) para análise
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
            {jobs.map((j) => (
              <div key={j.analysis_id} className="flex items-center justify-between gap-2 text-xs py-2 border-b border-slate-100 last:border-0">
                <span className="text-slate-600 truncate">{j.filename}</span>
                <Link href={`/edital/${j.analysis_id}`} className="text-[#047EA9] hover:text-cyan-300 shrink-0">
                  Acompanhar →
                </Link>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push('/')} className="btn btn-primary btn-sm">Ver no Pipeline</button>
            <button onClick={() => { setDone(false); setJobs([]); setFolderInput(''); }} className="btn btn-ghost btn-sm">Nova importação</button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="alert-danger rounded-xl p-3">
          <p className="text-sm">{errorMsg}</p>
          <button onClick={() => setErrorMsg(null)} className="btn btn-sm btn-ghost mt-2">Tentar novamente</button>
        </div>
      )}

      {!done && !loading && (
        <div className="flex justify-end gap-3">
          <Link href="/" className="btn btn-ghost">Cancelar</Link>
          <button onClick={submit} disabled={!folderInput.trim()} className="btn btn-primary disabled:opacity-40">
            Analisar pasta →
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------ Tab: URL pública ------------------
const KNOWN_PORTALS: Record<string, string> = {
  'comprasnet.gov.br': 'Comprasnet',
  'pncp.gov.br': 'PNCP',
  'bec.sp.gov.br': 'BEC-SP',
  'licitacoes-e.bb.com.br': 'Licitações-e',
};

function detectPortal(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return KNOWN_PORTALS[hostname] ?? null;
  } catch { return null; }
}

function TabURL() {
  const router = useRouter();
  const [urlInput, setUrlInput] = useState('');
  const [stage, setStage] = useState<AnalysisStage>('idle');
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [pgEditalId, setPgEditalId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [resultStatus, setResultStatus] = useState<string | null>(null);

  const portal = urlInput ? detectPortal(urlInput) : null;

  const poll = useCallback(async (id: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r = await fetch(`/api/proxy/editais/${id}`);
        if (!r.ok) continue;
        const data = await r.json();
        if (data.status === 'running') { setCurrentAgent(data.current_agent ?? null); continue; }
        if (data.status === 'queued') continue;
        if (data.status === 'failed') { setStage('failed'); setErrorMsg(data.error ?? 'Falha'); return; }
        const eid = data.pg_edital_id || data.edital_id || id;
        setPgEditalId(eid);
        setScore(data.score_comercial ?? data.result?.score_aderencia ?? null);
        setResultStatus(data.result?.status ?? null);
        setStage('done');
        return;
      } catch { continue; }
    }
    setStage('failed'); setErrorMsg('Tempo limite excedido.');
  }, []);

  async function submit() {
    const url = urlInput.trim();
    if (!url) return;
    setStage('uploading'); setErrorMsg(null);
    try {
      const r = await fetch('/api/proxy/analyze/from-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      if (data.status === 'already_exists') { router.push(`/edital/${data.analysis_id}`); return; }
      setAnalysisId(data.analysis_id);
      setStage('running');
      await poll(data.analysis_id);
    } catch (e: any) { setStage('failed'); setErrorMsg(e.message ?? 'Erro desconhecido'); }
  }

  return (
    <div className="space-y-4">
      {/* Portais suportados */}
      <div className="flex flex-wrap gap-2">
        {['Comprasnet', 'PNCP', 'BEC-SP', 'Licitações-e'].map((p) => (
          <span key={p} className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-400">{p}</span>
        ))}
        <span className="text-[11px] text-slate-300">+ qualquer URL pública de PDF</span>
      </div>

      <div>
        <label className="text-sm text-slate-600 mb-2 block font-medium">URL do edital</label>
        <div className="relative">
          {portal && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs bg-cyan-500/15 text-[#047EA9] border border-cyan-500/25 rounded px-1.5 py-0.5 font-medium z-10 pointer-events-none">
              {portal}
            </span>
          )}
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://www.comprasnet.gov.br/.../edital.pdf"
            className="input w-full"
            style={{ paddingLeft: portal ? '8rem' : undefined }}
            disabled={stage !== 'idle'}
            onKeyDown={(e) => { if (e.key === 'Enter' && urlInput.trim()) submit(); }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Cole a URL direta do PDF. Portais que exigem login (BEC-SP) podem não funcionar — use a aba PDF nesses casos.
        </p>
      </div>

      <ProgressWidget stage={stage} currentAgent={currentAgent} analysisId={analysisId} />
      <ResultWidget stage={stage} score={score} resultStatus={resultStatus} pgEditalId={pgEditalId}
        onRetry={() => { setStage('idle'); setErrorMsg(null); }} errorMsg={errorMsg} router={router} />

      {stage === 'idle' && (
        <div className="flex justify-end gap-3">
          <Link href="/" className="btn btn-ghost">Cancelar</Link>
          <button onClick={submit} disabled={!urlInput.trim()} className="btn btn-primary disabled:opacity-40">
            Baixar e analisar →
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------ Shared result widget ------------------
function ResultWidget({
  stage, score, resultStatus, pgEditalId, errorMsg, onRetry, router,
}: {
  stage: AnalysisStage;
  score: number | null;
  resultStatus: string | null;
  pgEditalId: string | null;
  errorMsg: string | null;
  onRetry: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  if (stage === 'done') {
    const scoreColor = score == null ? 'text-slate-500' : score >= 70 ? '#C0FF7D' : score >= 45 ? '#00BEFF' : '#E14849';
    return (
      <div className="card space-y-4" style={{ borderColor: 'rgba(192,255,125,0.25)' }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl" style={{ color: 'var(--x-green)' }}>✓</span>
          <p className="text-white font-semibold">Análise concluída</p>
        </div>
        {(score != null || resultStatus) && (
          <div className="flex gap-6 items-center">
            {score != null && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Score</p>
                <p className="text-4xl font-bold font-poppins" style={{ color: scoreColor }}>{score}%</p>
              </div>
            )}
            {resultStatus && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Status</p>
                <p className="text-white font-semibold">{resultStatus}</p>
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
    );
  }
  if (stage === 'failed') {
    return (
      <div className="alert-danger rounded-xl p-4 space-y-3">
        <p className="font-semibold">Falha na análise</p>
        {errorMsg && <p className="text-sm opacity-80">{errorMsg}</p>}
        <button onClick={onRetry} className="btn btn-sm btn-ghost">Tentar novamente</button>
      </div>
    );
  }
  return null;
}

// ------------------ Main page ------------------
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'pdf',    label: 'Arquivo PDF',      icon: '📄' },
  { key: 'drive',  label: 'Google Drive',     icon: '🔗' },
  { key: 'folder', label: 'Pasta do Drive',   icon: '📁' },
  { key: 'url',    label: 'URL pública',      icon: '🌐' },
];

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>('pdf');

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2 anim-fade">
      {/* Breadcrumb */}
      <div className="text-sm text-slate-400">
        <Link href="/" className="hover:text-slate-600 transition-colors">Pipeline</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-500">Novo edital</span>
      </div>

      <div className="fade-up">
        <h1 className="heading-lg mb-1">Importar Edital</h1>
        <p className="text-sm text-slate-400">PDF local, Google Drive, pasta ou URL pública — tudo em uma análise.</p>
      </div>

      {/* Tab switcher */}
      <div className="tabs-pill">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`tabs-pill-btn ${tab === key ? 'tabs-pill-btn-active' : ''}`}
          >
            <span className="mr-1.5">{icon}</span>{label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="card">
        {tab === 'pdf'    && <TabPDF />}
        {tab === 'drive'  && <TabDrive />}
        {tab === 'folder' && <TabFolder />}
        {tab === 'url'    && <TabURL />}
      </div>
    </div>
  );
}


