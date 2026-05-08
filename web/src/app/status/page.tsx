'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type ServiceStatus = 'ok' | 'degraded' | 'error' | 'checking';

type Health = {
  status: string;
  pg: 'ok' | 'degraded' | string;
  bq?: 'ok' | 'degraded' | string;
  vertex?: 'ok' | 'degraded' | string;
  version?: string;
  uptime_s?: number;
};

function dot(s: ServiceStatus) {
  if (s === 'ok')       return 'bg-green-500 shadow-[0_0_8px_#22c55e]';
  if (s === 'degraded') return 'bg-yellow-400 shadow-[0_0_8px_#facc15]';
  if (s === 'error')    return 'bg-red-500 shadow-[0_0_8px_#ef4444]';
  return 'bg-white/20 animate-pulse';
}

function StatusRow({
  label, status, detail,
}: { label: string; status: ServiceStatus; detail?: string }) {
  const text = status === 'ok'       ? 'Operacional'
             : status === 'degraded' ? 'Degradado'
             : status === 'error'    ? 'Falha'
             : 'Verificando…';

  const textColor = status === 'ok'       ? 'text-[#16A34A]'
                  : status === 'degraded' ? 'text-yellow-400'
                  : status === 'error'    ? 'text-[#B91C1C]'
                  : 'text-slate-400';

  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot(status)}`} />
        <div>
          <p className="text-sm text-slate-900 font-medium">{label}</p>
          {detail && <p className="text-xs text-slate-400 mt-0.5">{detail}</p>}
        </div>
      </div>
      <span className={`text-sm font-semibold flex-shrink-0 ${textColor}`}>{text}</span>
    </div>
  );
}

function toStatus(v?: string): ServiceStatus {
  if (!v) return 'checking';
  if (v === 'ok') return 'ok';
  return 'degraded';
}

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [jobs, setJobs] = useState<{ count: number; running: number } | null>(null);

  const check = useCallback(async () => {
    setFetchError(false);
    try {
      const [hr, jr] = await Promise.allSettled([
        fetch('/api/proxy/health'),
        fetch('/api/proxy/analyze?limit=50'),
      ]);

      if (hr.status === 'fulfilled' && hr.value.ok) {
        setHealth(await hr.value.json());
      } else {
        setFetchError(true);
      }

      if (jr.status === 'fulfilled' && jr.value.ok) {
        const jobList: any[] = await jr.value.json();
        const running = jobList.filter((j) => j.status === 'running' || j.status === 'queued').length;
        setJobs({ count: jobList.length, running });
      }

      setLastChecked(new Date());
    } catch {
      setFetchError(true);
    }
  }, []);

  useEffect(() => {
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [check]);

  const overall: ServiceStatus = fetchError ? 'error'
    : health == null ? 'checking'
    : health.pg !== 'ok' ? 'degraded'
    : 'ok';

  const overallLabel = overall === 'ok' ? 'Todos os sistemas operacionais'
    : overall === 'degraded' ? 'Degradação parcial detectada'
    : overall === 'error' ? 'Falha ao conectar ao backend'
    : 'Verificando…';

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2">
      {/* Breadcrumb */}
      <div className="text-sm text-slate-400">
        <Link href="/" className="hover:text-slate-600 transition-colors">Pipeline</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-500">Status</span>
      </div>

      <div className="fade-up">
        <h1 className="heading-lg mb-1">Status dos Sistemas</h1>
        <p className="text-sm text-slate-400">Saúde dos componentes de infraestrutura.</p>
      </div>

      {/* Overall banner */}
      <div
        className="rounded-2xl p-5 flex items-center gap-4"
        style={{
          background: overall === 'ok' ? 'rgba(192,255,125,0.05)' : overall === 'degraded' ? 'rgba(250,204,21,0.05)' : 'rgba(225,72,73,0.05)',
          border: `1px solid ${overall === 'ok' ? 'rgba(192,255,125,0.2)' : overall === 'degraded' ? 'rgba(250,204,21,0.2)' : 'rgba(225,72,73,0.2)'}`,
        }}
      >
        <span className={`w-4 h-4 rounded-full flex-shrink-0 ${dot(overall)}`} />
        <div className="flex-1">
          <p className="font-semibold text-slate-900">{overallLabel}</p>
          {lastChecked && (
            <p className="text-xs text-slate-400 mt-0.5">
              Última verificação: {lastChecked.toLocaleTimeString('pt-BR')}
            </p>
          )}
        </div>
        <button
          onClick={check}
          className="btn btn-ghost text-xs flex-shrink-0"
        >
          ↻ Atualizar
        </button>
      </div>

      {/* Services */}
      <div className="card">
        <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 px-1">Serviços</p>
        <StatusRow
          label="API Backend"
          status={fetchError ? 'error' : health ? 'ok' : 'checking'}
          detail="FastAPI — Cloud Run"
        />
        <StatusRow
          label="Cloud SQL (Postgres)"
          status={toStatus(health?.pg)}
          detail="Armazenamento de editais, jobs, comentários"
        />
        <StatusRow
          label="BigQuery"
          status={toStatus(health?.bq) === 'checking' ? (health ? 'ok' : 'checking') : toStatus(health?.bq)}
          detail="Histórico de análises e atestados"
        />
        <StatusRow
          label="Vertex AI / Gemini"
          status={toStatus(health?.vertex) === 'checking' ? (health ? 'ok' : 'checking') : toStatus(health?.vertex)}
          detail="Agentes de análise (Extrator, Qualificador, Analista)"
        />
        <StatusRow
          label="Google Drive API"
          status={health ? 'ok' : 'checking'}
          detail="Importação de editais via SA"
        />
      </div>

      {/* Jobs metrics */}
      {jobs !== null && (
        <div className="card grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Jobs recentes (50)</p>
            <p className="text-3xl font-bold font-poppins text-slate-900">{jobs.count}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Em execução / fila</p>
            <p className={`text-3xl font-bold font-poppins ${jobs.running > 0 ? 'text-[#047EA9]' : 'text-slate-500'}`}>
              {jobs.running}
            </p>
          </div>
        </div>
      )}

      {/* Backend version/uptime */}
      {health && (health.version || health.uptime_s != null) && (
        <div className="flex gap-6 text-xs text-slate-400">
          {health.version && <span>Versão: <span className="font-mono text-slate-500">{health.version}</span></span>}
          {health.uptime_s != null && (
            <span>Uptime: <span className="text-slate-500">{Math.floor(health.uptime_s / 60)}m</span></span>
          )}
        </div>
      )}
    </div>
  );
}
