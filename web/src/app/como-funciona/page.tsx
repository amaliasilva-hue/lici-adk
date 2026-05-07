import Link from 'next/link';

const AGENTS = [
  {
    num: '01',
    name: 'Extrator',
    color: 'var(--x-cyan)',
    glow: 'rgba(0,190,255,0.2)',
    icon: '🔍',
    desc: 'Lê o PDF inteiro do edital e extrai dados estruturados: órgão, modalidade licitatória, número do pregão, objeto, valor estimado, data de encerramento, requisitos de habilitação técnica e atestados exigidos.',
    outputs: ['Identificação do edital', 'Requisitos técnicos', 'Prazos e valores'],
  },
  {
    num: '02',
    name: 'Qualificador',
    color: 'var(--x-pink)',
    glow: 'rgba(255,137,255,0.2)',
    icon: '🔗',
    desc: 'Cruza os requisitos extraídos com a base BigQuery da Xertica: atestados de capacidade técnica, contratos executados, certificações Google/Cloud (GWS, GCP, Google Cloud Partner) e histórico de licitações anteriores.',
    outputs: ['Atestados correspondentes', 'Gaps de cobertura', 'Certificações mapeadas'],
  },
  {
    num: '03',
    name: 'Analista Comercial',
    color: 'var(--x-green)',
    glow: 'rgba(192,255,125,0.2)',
    icon: '📊',
    desc: 'Consolida as evidências e calcula o score de aderência (0–100%). Classifica o edital como APTO, COM RESSALVAS ou INAPTO. Gera um parecer comercial com recomendação de participação e estratégia de proposta.',
    outputs: ['Score 0–100%', 'Classificação APTO/RESSALVAS/INAPTO', 'Parecer com recomendação'],
  },
  {
    num: '04',
    name: 'Analista Jurídico',
    color: 'var(--x-orange)',
    glow: 'rgba(255,179,64,0.2)',
    icon: '⚖️',
    desc: 'Sob demanda, avalia a conformidade do edital com a Lei 14.133/2021 e súmulas do TCU. Identifica cláusulas restritivas, riscos jurídicos e sugere estratégias de impugnação ou esclarecimentos.',
    outputs: ['Conformidade Lei 14.133', 'Súmulas TCU aplicáveis', 'Riscos e recomendações jurídicas'],
  },
];

const DATA_SOURCES = [
  { icon: '🗄️', label: 'BigQuery',     desc: 'Atestados, contratos, certificações e histórico da Xertica' },
  { icon: '📁', label: 'Google Drive', desc: 'Atestados específicos por projeto (acesso via service account)' },
  { icon: '📜', label: 'Lei 14.133',   desc: 'Lei de Licitações vigente, carregada na base de conhecimento' },
  { icon: '🏛️', label: 'TCU Súmulas',  desc: '47 súmulas do Tribunal de Contas da União sobre licitações' },
];

export default function ComoFuncionaPage() {
  return (
    <div className="min-h-screen">
      {/* ── Hero ── */}
      <section className="text-center py-20 px-4">
        <p className="fade-up text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400 mb-4">
          Tecnologia
        </p>
        <h1 className="heading-xl fade-up delay-100 mb-4">
          Como a IA da Xertica<br className="hidden sm:block" />
          <span style={{ color: 'var(--x-cyan)' }}> analisa seu edital</span>
        </h1>
        <p className="fade-up delay-200 text-base text-slate-500 max-w-xl mx-auto leading-relaxed">
          4 agentes especializados trabalham em sequência, em ~35 segundos, para entregar uma análise
          tão precisa quanto a de um especialista com 10 anos de experiência em licitações governamentais.
        </p>

        {/* Tempo médio destaque */}
        <div className="fade-up delay-300 inline-flex items-center gap-3 mt-8 px-5 py-3 rounded-2xl"
          style={{ background: 'rgba(0,190,255,0.06)', border: '1px solid rgba(0,190,255,0.2)' }}>
          <span className="text-2xl font-poppins font-bold" style={{ color: 'var(--x-cyan)' }}>~35s</span>
          <span className="text-sm text-slate-500">análise comercial completa · inclui qualificação e parecer</span>
        </div>
      </section>

      {/* ── Pipeline visual ── */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <div className="grid md:grid-cols-2 gap-5">
          {AGENTS.map((agent, i) => (
            <div
              key={agent.num}
              className="card fade-up relative overflow-hidden"
              style={{
                animationDelay: `${0.1 + i * 0.1}s`,
                borderColor: `rgba(255,255,255,0.07)`,
              }}
            >
              {/* Glow accent */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{ background: `linear-gradient(90deg, transparent, ${agent.color}, transparent)` }}
              />
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-xl font-poppins font-bold"
                  style={{ background: agent.glow, border: `1px solid ${agent.color}22`, color: agent.color }}
                >
                  {agent.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: agent.color }}>
                      Passo {agent.num}
                    </span>
                  </div>
                  <h3 className="font-poppins font-bold text-lg text-slate-900 mb-2">{agent.name}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed mb-3">{agent.desc}</p>
                  <ul className="space-y-1">
                    {agent.outputs.map((out) => (
                      <li key={out} className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: agent.color }} />
                        {out}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Flow connector */}
        <div className="flex items-center justify-center gap-2 py-8 text-slate-300 text-xs">
          <span className="w-8 h-px" style={{ background: 'var(--x-cyan)' }} />
          <span>sequencial · paralelo onde possível · resultado em ~35s</span>
          <span className="w-8 h-px" style={{ background: 'var(--x-pink)' }} />
        </div>
      </section>

      {/* ── Fontes de dados ── */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <h2 className="font-poppins font-bold text-2xl text-slate-900 text-center mb-8">
          Fontes de dados
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {DATA_SOURCES.map((src) => (
            <div key={src.label} className="card text-center">
              <div className="text-3xl mb-3">{src.icon}</div>
              <div className="font-poppins font-semibold text-slate-900 text-sm mb-1">{src.label}</div>
              <div className="text-xs text-slate-500 leading-relaxed">{src.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Status da análise jurídica ── */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <div className="card" style={{ borderColor: 'rgba(255,179,64,0.2)' }}>
          <div className="flex items-start gap-4">
            <span className="text-2xl flex-shrink-0">⚖️</span>
            <div>
              <h3 className="font-poppins font-semibold text-slate-900 mb-1">
                Análise jurídica é sob demanda
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                A análise comercial (passos 1–3) é executada automaticamente ao carregar o edital.
                A análise jurídica (passo 4) é mais demorada e cara — ela é solicitada separadamente
                no detalhe do edital, para editais que avançaram ao estágio de decisão de participar.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="text-center pb-24 px-4">
        <h2 className="font-poppins font-bold text-2xl text-white mb-3">
          Pronto para analisar seu primeiro edital?
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          Carregue o PDF e tenha o resultado em menos de 1 minuto.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/upload" className="btn btn-primary px-8 py-3 text-base">
            Analisar edital →
          </Link>
          <Link href="/" className="btn btn-ghost px-8 py-3 text-base">
            Ver Pipeline
          </Link>
        </div>
      </section>
    </div>
  );
}
