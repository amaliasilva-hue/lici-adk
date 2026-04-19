'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Job = {
  analysis_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  current_agent?: string | null;
  error?: string;
};

const AGENT_LABELS: Record<string, string> = {
  extrator:     'Extratando dados…',
  qualificador: 'Qualificando requisitos…',
  analista:     'Analisando aderência…',
};

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile]   = useState<File | null>(null);
  const [busy, setBusy]   = useState(false);
  const [job,  setJob]    = useState<Job | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag]   = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === 'application/pdf') setFile(f);
    else setError('Somente arquivos .pdf são aceitos.');
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setJob(null);
    setBusy(true);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/proxy/analyze', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`Erro ${r.status}: ${await r.text()}`);
      const created: Job = await r.json();
      setJob(created);

      // polling
      while (true) {
        await new Promise((res) => setTimeout(res, 3000));
        const pr = await fetch(`/api/proxy/analyze/${created.analysis_id}`);
        if (!pr.ok) throw new Error(`Polling error ${pr.status}`);
        const j: Job = await pr.json();
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') break;
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  }

  // Redirect to edital detail when done
  if (job?.status === 'done') {
    router.push(`/edital/${job.analysis_id}`);
    return null;
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="font-poppins font-bold text-2xl text-white">Novo edital</h1>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`card cursor-pointer border-2 transition-all flex flex-col items-center gap-3 py-12 text-center ${
          drag ? 'border-primary bg-primary/10' : 'border-dashed border-white/20 hover:border-primary/50'
        }`}
      >
        <svg className="w-12 h-12 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        {file ? (
          <div>
            <p className="text-white font-medium">{file.name}</p>
            <p className="text-sm text-white/40">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
        ) : (
          <div>
            <p className="text-white/60">Arraste o PDF aqui ou clique para selecionar</p>
            <p className="text-xs text-white/30 mt-1">Máx 30 MB · apenas .pdf</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFile(f);
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="card border-danger/50 text-danger text-sm">{error}</div>
      )}

      {/* Progress */}
      {busy && job && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">
              {job.current_agent ? AGENT_LABELS[job.current_agent] ?? 'Processando…' : 'Iniciando…'}
            </span>
            <span className="text-white/40">{elapsed}s</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(elapsed * 2, 90)}%` }}
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={submit}
        disabled={!file || busy}
        className="btn btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? 'Analisando…' : 'Analisar edital'}
      </button>
    </div>
  );
}
