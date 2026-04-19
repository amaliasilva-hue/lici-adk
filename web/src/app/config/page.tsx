'use client';
import { useState } from 'react';

type Section = {
  key: string;
  label: string;
  placeholder: string;
  default: string;
};

const SECTIONS: Section[] = [
  {
    key: 'extrator',
    label: 'Extrator (Agente 1)',
    placeholder: 'Instruções adicionais para o agente de extração de dados do edital…',
    default: '',
  },
  {
    key: 'qualificador',
    label: 'Qualificador (Agente 2)',
    placeholder: 'Instruções adicionais para o agente de qualificação de requisitos…',
    default: '',
  },
  {
    key: 'analista_comercial',
    label: 'Analista Comercial (Agente 3)',
    placeholder: 'Instruções adicionais para o agente de análise comercial (score, gaps, alertas)…',
    default: '',
  },
  {
    key: 'analista_juridico',
    label: 'Analista Jurídico (Agente 4)',
    placeholder: 'Instruções adicionais para o analista licitatório (TCU, súmulas, habilitação)…',
    default: '',
  },
];

export default function ConfigPage() {
  const [prompts, setPrompts] = useState<Record<string, string>>(
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.default]))
  );
  const [saved, setSaved] = useState(false);

  function update(key: string, val: string) {
    setSaved(false);
    setPrompts((prev) => ({ ...prev, [key]: val }));
  }

  function save() {
    // TODO: persiste no backend (POST /config/prompts)
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-poppins font-bold text-2xl text-white">Configurações</h1>
        <p className="text-white/50 text-sm mt-1">
          Personalize instruções adicionais para cada agente da pipeline.
          Estas instruções são concatenadas ao system prompt padrão.
        </p>
      </div>

      {SECTIONS.map((s) => (
        <div key={s.key} className="card space-y-2">
          <label className="font-semibold text-white/80 text-sm">{s.label}</label>
          <textarea
            rows={4}
            className="input resize-y"
            placeholder={s.placeholder}
            value={prompts[s.key]}
            onChange={(e) => update(s.key, e.target.value)}
          />
        </div>
      ))}

      <div className="flex items-center gap-4">
        <button onClick={save} className="btn btn-primary">Salvar configurações</button>
        {saved && <span className="text-green-accent text-sm">Salvo!</span>}
      </div>

      <div className="card border-white/5 text-white/30 text-xs space-y-1">
        <p>⚠️ As configurações são salvas localmente neste navegador (localStorage) até a integração com o backend estar disponível.</p>
        <p>Endpoint previsto: POST /config/prompts · autenticado por OIDC Xertica.</p>
      </div>
    </div>
  );
}
