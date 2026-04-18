'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { ParecerView } from '@/components/parecer-view';

type Job = {
  analysis_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  current_agent?: string | null;
  result?: any;
  error?: string;
};

export default function Home() {
  const { data: session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
      if (!r.ok) throw new Error(`POST /analyze ${r.status}: ${await r.text()}`);
      const created: Job = await r.json();
      setJob(created);

      while (true) {
        await new Promise((res) => setTimeout(res, 3000));
        const pr = await fetch(`/api/proxy/analyze/${created.analysis_id}`);
        if (!pr.ok) throw new Error(`GET status ${pr.status}`);
        const j: Job = await pr.json();
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') break;
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  }

  if (!session && process.env.NEXT_PUBLIC_REQUIRE_LOGIN === '1') {
    return (
      <div className="card text-center">
        <h1 className="text-2xl font-bold text-xertica-700 mb-2">lici-adk</h1>
        <p className="text-slate-600 mb-4">Análise de licitações públicas com IA agêntica.</p>
        <p className="text-sm text-slate-500">Faça login com sua conta @xertica.com para começar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-xl font-bold mb-1">Nova análise</h1>
        <p className="text-sm text-slate-500 mb-4">
          Envie o PDF do edital. O pipeline (Extrator → Qualificador → Analista → Persistor) leva
          até 4 minutos para editais de 60-100 páginas.
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            disabled={busy}
          />
          <button onClick={submit} disabled={!file || busy} className="btn btn-primary disabled:opacity-50">
            {busy ? 'Analisando…' : 'Analisar edital'}
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      </div>

      {job && (
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">analysis_id</div>
              <div className="font-mono text-sm">{job.analysis_id}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">status</div>
              <div>
                <span className={
                  job.status === 'done' ? 'badge bg-green-100 text-green-800'
                  : job.status === 'failed' ? 'badge bg-red-100 text-red-800'
                  : 'badge bg-blue-100 text-blue-800'
                }>{job.status}</span>
                {job.current_agent && <span className="ml-2 text-xs text-slate-500">agente: {job.current_agent}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">tempo</div>
              <div className="font-mono">{elapsed}s</div>
            </div>
          </div>
          {job.error && <div className="mt-3 text-sm text-red-600">Erro: {job.error}</div>}
        </div>
      )}

      {job?.result && <ParecerView parecer={job.result} />}
    </div>
  );
}
