type Parecer = {
  score_aderencia: number | null;
  status: string;
  bloqueio_camada_1: string | null;
  estrategia: string;
  alertas: string[];
  requisitos_atendidos: { requisito: string; comprovacao: string; fonte: string; link?: string | null }[];
  evidencias_por_requisito: { requisito: string; fonte_tabela: string; fonte_id?: string | null; trecho_literal: string; tipo_evidencia: string; confianca: number }[];
  gaps: { requisito: string; tipo: string; delta_numerico?: number | null; recomendacao: string }[];
  campos_trello?: any;
  edital_orgao?: string | null;
  edital_modalidade?: string | null;
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    'APTO': 'bg-green-100 text-green-800',
    'APTO COM RESSALVAS': 'bg-amber-100 text-amber-800',
    'INAPTO': 'bg-red-100 text-red-800',
    'NO-GO': 'bg-red-200 text-red-900',
  };
  return map[status] || 'bg-slate-100 text-slate-800';
}

export function ParecerView({ parecer }: { parecer: Parecer }) {
  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs text-slate-500 uppercase">Parecer</div>
            <h2 className="text-xl font-bold">{parecer.edital_orgao || '—'}</h2>
            {parecer.edital_modalidade && (
              <div className="text-sm text-slate-500">{parecer.edital_modalidade}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-5xl font-bold tabular-nums">
              {parecer.score_aderencia ?? '—'}
            </div>
            <span className={`badge ${statusBadge(parecer.status)} mt-2`}>{parecer.status}</span>
          </div>
        </div>
        {parecer.bloqueio_camada_1 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
            <strong>Bloqueio camada 1:</strong> {parecer.bloqueio_camada_1}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="font-semibold mb-2">Estratégia</h3>
        <p className="text-sm whitespace-pre-line text-slate-700">{parecer.estrategia}</p>
      </div>

      {parecer.alertas?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-2">Alertas</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
            {parecer.alertas.map((a, i) => <li key={i}>{a}</li>)}
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
                <div className="text-xs text-slate-400 mt-1">fonte: {r.fonte}{r.link ? ` · ${r.link}` : ''}</div>
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
                <summary className="cursor-pointer text-sm font-medium">
                  {e.requisito}
                  <span className="ml-2 text-xs text-slate-400">
                    {e.tipo_evidencia} · confiança {Math.round(e.confianca * 100)}%
                  </span>
                </summary>
                <div className="mt-2 text-xs text-slate-600">
                  <div><strong>Tabela:</strong> {e.fonte_tabela} · <strong>ID:</strong> {e.fonte_id || '—'}</div>
                  <div className="mt-1 italic">"{e.trecho_literal}"</div>
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
                <div className="text-xs text-slate-500">tipo: {g.tipo}{g.delta_numerico != null ? ` · Δ ${g.delta_numerico}` : ''}</div>
                <div className="text-xs text-slate-700">{g.recomendacao}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
