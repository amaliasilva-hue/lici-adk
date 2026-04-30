'use client';
import { Suspense, useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'user' | 'assistant';

interface Attachment {
  filename: string;
  mime_type: string;
  size: number;
  localUrl?: string;
}

interface ChatMessage {
  message_id?: string;
  role: Role;
  content: string;
  attachments_meta?: Attachment[];
  created_at?: string;
  pending?: boolean;
}

interface Session {
  session_id: string;
  title: string;
  edital_id?: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  message_count?: number;
  messages?: ChatMessage[];
}

interface PendingFile {
  file: File;
  localUrl: string;
  id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMs < 60000) return 'agora';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}min`;
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function groupByDate(sessions: Session[]): { label: string; items: Session[] }[] {
  const now = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = start(now);
  const yesterday = new Date(today.getTime() - 86400000);
  const week = new Date(today.getTime() - 7 * 86400000);
  const month = new Date(today.getTime() - 30 * 86400000);
  const groups: { label: string; items: Session[] }[] = [
    { label: 'Hoje', items: [] },
    { label: 'Ontem', items: [] },
    { label: 'Últimos 7 dias', items: [] },
    { label: 'Último mês', items: [] },
    { label: 'Mais antigos', items: [] },
  ];
  for (const s of sessions) {
    const d = new Date(s.updated_at);
    if (d >= today) groups[0].items.push(s);
    else if (d >= yesterday) groups[1].items.push(s);
    else if (d >= week) groups[2].items.push(s);
    else if (d >= month) groups[3].items.push(s);
    else groups[4].items.push(s);
  }
  return groups.filter(g => g.items.length > 0);
}

function isDocument(content: string): boolean {
  const u = content.toUpperCase();
  return (
    u.includes('ATESTADO DE CAPACIDADE TÉ') ||
    u.includes('ATESTADO DE PRESTA') ||
    (u.includes('CONTRATANTE:') && u.includes('CONTRATADA:') && u.includes('OBJETO:'))
  );
}

// ─── Markdown ─────────────────────────────────────────────────────────────────
function MdContent({ content }: { content: string }) {
  return (
    <ReactMarkdown components={{
      p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold" style={{ color: '#E2E8F0' }}>{children}</strong>,
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer"
          style={{ color: '#00BEFF' }} className="underline underline-offset-2 hover:opacity-80">{children}</a>
      ),
      ul: ({ children }) => <ul className="list-none space-y-1 my-2">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-slate-300">{children}</ol>,
      li: ({ children }) => (
        <li className="flex gap-2 items-start text-slate-300">
          <span style={{ color: '#00BEFF', flexShrink: 0 }} className="mt-0.5 text-[10px]">▸</span>
          <span>{children}</span>
        </li>
      ),
      h1: ({ children }) => (
        <h1 className="font-poppins font-bold text-white text-base mt-4 mb-2 flex items-center gap-2">
          <span className="w-1 h-4 rounded-full inline-block shrink-0" style={{ background: '#00BEFF' }} />
          {children}
        </h1>
      ),
      h2: ({ children }) => <h2 className="font-poppins font-semibold text-sm mt-3 mb-1.5 uppercase tracking-wider" style={{ color: '#94A3B8' }}>{children}</h2>,
      h3: ({ children }) => <h3 className="font-semibold text-white text-sm mt-2 mb-1">{children}</h3>,
      blockquote: ({ children }) => (
        <blockquote className="pl-3 italic my-2 text-slate-400" style={{ borderLeft: '2px solid rgba(0,190,255,0.4)' }}>{children}</blockquote>
      ),
      code: ({ children, className }) => (
        className?.includes('language-')
          ? <pre className="rounded-xl p-4 text-xs font-mono overflow-x-auto my-3" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.07)', color: '#C0FF7D' }}><code>{children}</code></pre>
          : <code className="rounded px-1.5 py-0.5 text-[11px] font-mono" style={{ background: 'rgba(0,190,255,0.1)', color: '#00BEFF' }}>{children}</code>
      ),
      table: ({ children }) => (
        <div className="overflow-x-auto my-3 rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <table className="w-full text-xs border-collapse">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="text-left pb-2 pt-3 px-4 font-semibold text-[10px] uppercase tracking-wider" style={{ color: '#64748B', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>{children}</th>,
      td: ({ children }) => <td className="py-2.5 px-4 text-slate-300" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{children}</td>,
      hr: () => <hr className="my-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />,
    }}>
      {content}
    </ReactMarkdown>
  );
}

// ─── Glow card (mouse-tracking) ──────────────────────────────────────────────
function GlowCard({ onClick, color, icon, label, hint }: {
  onClick: () => void; color: string; icon: React.ReactNode; label: string; hint: string;
}) {
  function onMouseMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
  return (
    <button onClick={onClick} onMouseMove={onMouseMove}
      className="group relative overflow-hidden text-left px-4 py-3.5 rounded-2xl transition-all duration-200"
      style={{ '--mx': '50%', '--my': '50%', background: 'rgba(13,19,31,0.7)', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' } as React.CSSProperties}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = color + '35';
        el.style.transform = 'translateY(-2px)';
        el.style.boxShadow = `0 12px 32px ${color}18`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(255,255,255,0.07)';
        el.style.transform = '';
        el.style.boxShadow = '';
      }}>
      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `radial-gradient(180px circle at var(--mx) var(--my), ${color}14, transparent)` }} />
      <div className="relative">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span style={{ color }}>{icon}</span>
          <span className="text-sm font-semibold" style={{ color: '#E2E8F0' }}>{label}</span>
        </div>
        <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: '#475569' }}>{hint}</p>
      </div>
    </button>
  );
}

// ─── Document card ─────────────────────────────────────────────────────────────
function DocCard({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  function download() {
    const clean = content.replace(/\*\*/g, '').replace(/^#+\s/gm, '');
    const blob = new Blob([clean], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'atestado_capacidade_tecnica.txt'; a.click();
    URL.revokeObjectURL(url);
  }
  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(0,190,255,0.25)', background: 'rgba(0,190,255,0.025)', boxShadow: '0 4px 24px rgba(0,190,255,0.07)' }}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'rgba(0,190,255,0.06)', borderBottom: '1px solid rgba(0,190,255,0.12)' }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-semibold tracking-wide" style={{ color: '#00BEFF' }}>Documento gerado</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={copy}
            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
            style={{ color: copied ? '#C0FF7D' : '#64748B', background: copied ? 'rgba(192,255,125,0.08)' : 'transparent', border: '1px solid', borderColor: copied ? 'rgba(192,255,125,0.25)' : 'rgba(255,255,255,0.07)' }}>
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
          <button onClick={download}
            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
            style={{ color: '#00BEFF', background: 'rgba(0,190,255,0.08)', border: '1px solid rgba(0,190,255,0.2)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,190,255,0.16)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,190,255,0.08)'; }}>
            ↓ .txt
          </button>
        </div>
      </div>
      <div className="px-4 py-4 max-h-72 overflow-y-auto chat-scroller text-sm" style={{ color: '#CBD5E1' }}>
        <MdContent content={content} />
      </div>
    </div>
  );
}

// ─── Thinking dots ─────────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-2 h-2 rounded-full"
          style={{ background: 'rgba(0,190,255,0.5)', animation: `chatDot 1.4s ease-in-out ${i * 0.22}s infinite` }} />
      ))}
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const rawContent = msg.content.replace(/^\[Arquivos:.*?\]\n/, '');
  const showDoc = !isUser && !msg.pending && isDocument(rawContent);
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-end`}
      style={{ animation: 'chatMsgIn 0.28s cubic-bezier(0.16,1,0.3,1) both' }}>

      {!isUser && (
        <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.6),rgba(0,190,255,0.4))', border: '1px solid rgba(0,190,255,0.3)', boxShadow: '0 0 14px rgba(0,190,255,0.15)' }}>
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
      )}

      <div className={`max-w-[78%] flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        {msg.attachments_meta && msg.attachments_meta.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.attachments_meta.map((a, i) => (
              a.mime_type.startsWith('image/') && a.localUrl ? (
                <img key={i} src={a.localUrl} alt={a.filename}
                  className="max-h-52 max-w-xs rounded-2xl object-cover"
                  style={{ border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }} />
              ) : (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                  style={{ background: 'rgba(0,190,255,0.06)', border: '1px solid rgba(0,190,255,0.15)' }}>
                  <svg className="w-4 h-4 shrink-0" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-slate-300 max-w-[140px] truncate">{a.filename}</span>
                  <span className="text-slate-600 shrink-0">{fmtSize(a.size)}</span>
                </div>
              )
            ))}
          </div>
        )}

        {showDoc ? (
          <DocCard content={rawContent} />
        ) : (rawContent.trim() || msg.pending) && (
          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
            style={isUser ? {
              background: 'linear-gradient(135deg,#047EA9 0%,#0598C8 100%)',
              color: 'rgba(255,255,255,0.95)',
              boxShadow: '0 4px 24px rgba(4,126,169,0.35)',
            } : {
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: '#CBD5E1',
            }}>
            {msg.pending ? <ThinkingDots /> : (
              isUser
                ? <p className="whitespace-pre-wrap">{rawContent}</p>
                : <MdContent content={rawContent} />
            )}
          </div>
        )}

        {msg.created_at && !msg.pending && (
          <span className="text-[10px] px-1" style={{ color: 'rgba(100,116,139,0.7)' }}>{fmtDate(msg.created_at)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Session item ──────────────────────────────────────────────────────────────
function SessionItem({ session, active, onClick, onDelete }: {
  session: Session; active: boolean; onClick: () => void; onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 group relative"
      style={{ background: active ? 'rgba(0,190,255,0.06)' : 'transparent', border: active ? '1px solid rgba(0,190,255,0.18)' : '1px solid transparent' }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium line-clamp-1 flex-1 min-w-0" style={{ color: active ? '#E2E8F0' : '#94A3B8' }}>
          {session.title}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {session.edital_id && (
            <span className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: '#00BEFF', boxShadow: '0 0 6px rgba(0,190,255,0.6)' }} title="Vinculado a edital" />
          )}
          <span className="text-[10px]" style={{ color: '#475569' }}>{fmtDate(session.updated_at)}</span>
          <button onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded"
            style={{ color: '#475569' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#475569'}
            title="Deletar">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {session.last_message && (
        <p className="text-[11px] line-clamp-1 mt-0.5" style={{ color: '#334155' }}>
          {session.last_message.replace(/^\[Arquivos:.*?\]\n/, '')}
        </p>
      )}
    </button>
  );
}

// ─── Edital welcome card ───────────────────────────────────────────────────────
function EditalWelcomeCard({ onAction }: { onAction: (text: string) => void }) {
  const actions = [
    {
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
      label: 'Analisar aptidão técnica',
      color: '#C0FF7D',
      colorBg: 'rgba(192,255,125,0.08)',
      prompt: 'Analise a aptidão técnica da Xertica para este edital. Liste os requisitos encontrados, os atestados e certificações que os atendem, e os gaps que precisam ser endereçados.',
    },
    {
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
      label: 'Checklist de atestados',
      color: '#00BEFF',
      colorBg: 'rgba(0,190,255,0.08)',
      prompt: 'Monte um checklist de atestados necessários para habilitação neste edital. Para cada requisito: temos atestado formal? Há contratos sem atestado (posso solicitar)? Indique o órgão e link quando disponível.',
    },
    {
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
      label: 'Estratégia de participação',
      color: '#FF89FF',
      colorBg: 'rgba(255,137,255,0.08)',
      prompt: 'Com base nos dados disponíveis, qual a estratégia recomendada para participar deste edital? Considere atestados disponíveis, gaps, histórico com órgãos similares e deals ganhos em temas relacionados.',
    },
    {
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
      label: 'Gerar minuta de atestado',
      color: '#FFB340',
      colorBg: 'rgba(255,179,64,0.08)',
      prompt: 'Gere uma minuta de Atestado de Capacidade Técnica para este edital. Busque contratos relevantes da Xertica no BigQuery e formate o documento com: cabeçalho ATESTADO DE CAPACIDADE TÉCNICA, contratante, contratada (Xertica), objeto, período, descrição dos serviços, declaração de satisfação, espaço para assinatura.',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full pb-6 px-4">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.3),rgba(0,190,255,0.15))', border: '1px solid rgba(0,190,255,0.25)', boxShadow: '0 0 40px rgba(0,190,255,0.12)' }}>
          <svg className="w-7 h-7" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-3"
          style={{ background: 'rgba(0,190,255,0.08)', border: '1px solid rgba(0,190,255,0.2)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#00BEFF', boxShadow: '0 0 6px rgba(0,190,255,0.8)', animation: 'pulse 2s ease-in-out infinite' }} />
          <span className="text-xs font-medium" style={{ color: '#00BEFF' }}>Edital vinculado</span>
        </div>
        <h2 className="font-poppins font-bold text-lg text-white mb-2">Como posso ajudar?</h2>
        <p className="text-sm max-w-sm mx-auto" style={{ color: '#64748B' }}>
          Acesso completo ao banco de atestados, contratos e histórico. Escolha uma ação ou faça sua pergunta.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
        {actions.map((a, i) => (
          <GlowCard key={i} onClick={() => onAction(a.prompt)}
            color={a.color} icon={a.icon} label={a.label} hint={a.prompt.slice(0, 80)} />
        ))}
      </div>
      <p className="mt-5 text-xs" style={{ color: '#1E293B' }}>ou arraste o PDF do edital para análise direta ↓</p>
    </div>
  );
}

// ─── General empty state ───────────────────────────────────────────────────────
function GeneralWelcome({ onSelect }: { onSelect: (q: string) => void }) {
  const suggestions = [
    { label: 'Atestados de GCP', q: 'Para quais órgãos temos atestados de Google Cloud? Lista por conta com total e datas.' },
    { label: 'Contratos sem atestado', q: 'Liste contratos da Xertica que ainda não têm atestado formal — oportunidades para solicitar.' },
    { label: 'Certificações vigentes', q: 'Quais certificações em Cloud e IA estão vigentes hoje? Agrupe por tema.' },
    { label: 'Análises recentes', q: 'Mostre as 10 análises de editais mais recentes com status e score.' },
    { label: 'Gaps de habilitação', q: 'Quais os principais gaps que levam a INAPTO nas análises históricas?' },
    { label: 'Gerar minuta de atestado', q: 'Quero gerar uma minuta de Atestado de Capacidade Técnica. Me ajude a identificar o contrato e formate o documento.' },
  ];
  const colors = ['#C0FF7D', '#00BEFF', '#FF89FF', '#FFB340', '#C0FF7D', '#00BEFF'];

  return (
    <div className="flex flex-col items-center justify-center h-full pb-8 px-4">
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute inset-0 rounded-3xl" style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.2),rgba(0,190,255,0.1))', border: '1px solid rgba(0,190,255,0.15)' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-10 h-10" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.4} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <div className="absolute -inset-3" style={{ background: 'radial-gradient(circle,rgba(0,190,255,0.07),transparent 70%)', pointerEvents: 'none' }} />
      </div>
      <h2 className="font-poppins font-bold text-xl text-white mb-2 text-center">Chat IA · Xertica Licitações</h2>
      <p className="text-sm text-center max-w-sm mb-8" style={{ color: '#475569' }}>
        Acesso em tempo real a atestados, contratos, certificações e histórico de análises. Pergunte ou anexe documentos.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full max-w-2xl">
        {suggestions.map((s, i) => (
          <GlowCard key={i} onClick={() => onSelect(s.q)}
            color={colors[i]} icon={null} label={s.label} hint={s.q.slice(0, 70)} />
        ))}
      </div>
    </div>
  );
}

// ─── Main inner component ──────────────────────────────────────────────────────
function ChatPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeSession?.messages?.length]);
  useEffect(() => { loadSessions(); }, []);

  const editalParam = params.get('edital');
  const editalHandledRef = useRef(false);
  useEffect(() => {
    if (!editalParam || editalHandledRef.current) return;
    editalHandledRef.current = true;
    createSession(editalParam).then(() => router.replace('/chat'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editalParam]);

  async function loadSessions() {
    try {
      const r = await fetch('/api/proxy/chat/sessions?limit=80');
      if (!r.ok) return;
      const data: Session[] = await r.json();
      setSessions(data);
      if (data.length > 0 && !activeSession) selectSession(data[0].session_id);
    } catch {}
  }

  async function selectSession(sessionId: string) {
    try {
      const r = await fetch(`/api/proxy/chat/sessions/${sessionId}`);
      if (!r.ok) return;
      const data: Session = await r.json();
      startTransition(() => setActiveSession(data));
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch {}
  }

  async function createSession(editalId?: string) {
    const title = editalId ? 'Conversa sobre edital' : 'Nova conversa';
    const qs = new URLSearchParams({ title });
    if (editalId) qs.set('edital_id', editalId);
    try {
      const r = await fetch(`/api/proxy/chat/sessions?${qs}`, { method: 'POST' });
      if (!r.ok) {
        const msg = await r.text().catch(() => '');
        setError(`Erro ao criar conversa: ${r.status}${msg ? ' – ' + msg.slice(0, 100) : ''}`);
        return null;
      }
      const s: Session = await r.json();
      s.messages = [];
      setSessions(prev => [s, ...prev]);
      setActiveSession(s);
      setTimeout(() => inputRef.current?.focus(), 80);
      return s;
    } catch (e: any) {
      setError(`Sem conexão: ${e.message}`);
      return null;
    }
  }

  async function deleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/proxy/chat/sessions/${sessionId}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.session_id !== sessionId));
    if (activeSession?.session_id === sessionId) setActiveSession(null);
  }

  async function renameSession(sessionId: string, title: string) {
    await fetch(`/api/proxy/chat/sessions/${sessionId}/title?title=${encodeURIComponent(title)}`, { method: 'PATCH' });
    setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, title } : s));
    setActiveSession(prev => prev?.session_id === sessionId ? { ...prev, title } : prev);
  }

  async function uploadEditalFile(file: File) {
    let session = activeSession;
    if (!session) { session = await createSession(); if (!session) return; }
    const sid = session.session_id;
    const form = new FormData();
    form.append('file', file, file.name);
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/proxy/chat/sessions/${sid}/upload_edital`, { method: 'POST', body: form });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.detail || `Erro ${r.status}`); }
      await selectSession(sid);
    } catch (e: any) {
      setError(e.message || 'Falha no upload do edital');
    } finally {
      setSending(false);
    }
  }

  function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter(f =>
      ['image/', 'application/pdf', 'text/plain'].some(a => f.type.startsWith(a))
    );
    setPendingFiles(prev => [...prev, ...valid.map(f => ({
      file: f, localUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '', id: uid(),
    }))]);
  }

  function removeFile(id: string) {
    setPendingFiles(prev => {
      const f = prev.find(p => p.id === id);
      if (f?.localUrl) URL.revokeObjectURL(f.localUrl);
      return prev.filter(p => p.id !== id);
    });
  }

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text && pendingFiles.length === 0) return;
    if (sending) return;

    let session = activeSession;
    if (!session) {
      session = await createSession();
      if (!session) return;
    }
    const sid = session.session_id;

    const optimisticAttachments: Attachment[] = pendingFiles.map(p => ({
      filename: p.file.name, mime_type: p.file.type, size: p.file.size, localUrl: p.localUrl,
    }));
    const userMsg: ChatMessage = {
      role: 'user', content: text || '(arquivo)',
      attachments_meta: optimisticAttachments.length > 0 ? optimisticAttachments : undefined,
      created_at: new Date().toISOString(),
    };
    const pendingMsg: ChatMessage = { role: 'assistant', content: '', pending: true };

    setActiveSession(prev => prev ? { ...prev, messages: [...(prev.messages ?? []), userMsg, pendingMsg] } : prev);
    const capturedFiles = [...pendingFiles];
    setInput('');
    setPendingFiles([]);
    setSending(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('text', text || '(arquivo)');
      for (const pf of capturedFiles) form.append('files', pf.file, pf.file.name);

      const r = await fetch(`/api/proxy/chat/sessions/${sid}/messages`, { method: 'POST', body: form });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.detail || `Erro ${r.status}`);
      }
      const data = await r.json();
      const replyMsg: ChatMessage = {
        message_id: data.message_id, role: 'assistant', content: data.reply, created_at: new Date().toISOString(),
      };
      startTransition(() => {
        setActiveSession(prev => {
          if (!prev) return prev;
          return { ...prev, messages: [...(prev.messages ?? []).filter(m => !m.pending), replyMsg] };
        });
        setSessions(prev => prev.map(s =>
          s.session_id === sid ? { ...s, last_message: data.reply.slice(0, 80), updated_at: new Date().toISOString() } : s
        ));
        if ((session?.messages ?? []).length === 0) setTimeout(loadSessions, 1200);
      });
      capturedFiles.forEach(f => { if (f.localUrl) URL.revokeObjectURL(f.localUrl); });
    } catch (e: any) {
      setError(e.message || 'Falha ao enviar');
      setActiveSession(prev => prev ? { ...prev, messages: (prev.messages ?? []).filter(m => !m.pending) } : prev);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }

  const messages = activeSession?.messages ?? [];
  const isEmpty = messages.length === 0;
  const hasEdital = !!(activeSession?.edital_id);
  const canSend = (input.trim().length > 0 || pendingFiles.length > 0) && !sending;
  const hasPdfPending = pendingFiles.some(f => f.file.type === 'application/pdf');

  return (
    <>
      <style>{`
        @keyframes chatDot {
          0%,80%,100% { transform:scale(0.65); opacity:0.3; }
          40%          { transform:scale(1.15); opacity:1; }
        }
        @keyframes chatMsgIn {
          from { opacity:0; transform:translateY(12px) scale(0.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        .chat-scroller::-webkit-scrollbar { width:3px; }
        .chat-scroller::-webkit-scrollbar-track { background:transparent; }
        .chat-scroller::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.06); border-radius:3px; }
        .chat-scroller::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.12); }
        .chat-textarea::placeholder { color:rgba(100,116,139,0.55); }
      `}</style>

      <div className="flex overflow-hidden"
        style={{ height: 'calc(100vh - 64px)', marginTop: '-1rem', marginLeft: '-1.5rem', marginRight: '-1.5rem' }}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

        {/* ── Sidebar ─────────────────────────────────── */}
        <aside className="shrink-0 flex flex-col transition-all duration-300 ease-in-out overflow-hidden"
          style={{
            width: sidebarOpen ? '260px' : '0',
            background: 'rgba(3,7,13,0.78)',
            borderRight: '1px solid rgba(255,255,255,0.05)',
            backdropFilter: 'blur(20px)',
          }}>
          <div className="flex flex-col h-full min-w-[260px]">
            <div className="px-3 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <button onClick={() => createSession()}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.4),rgba(0,190,255,0.2))', border: '1px solid rgba(0,190,255,0.25)', boxShadow: '0 0 20px rgba(0,190,255,0.06)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 28px rgba(0,190,255,0.2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(0,190,255,0.06)'; }}>
                <svg className="w-4 h-4 shrink-0" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Nova conversa
              </button>
            </div>

            <div className="flex-1 overflow-y-auto chat-scroller px-2 py-2">
              {sessions.length === 0 ? (
                <p className="text-center py-8 text-xs" style={{ color: '#1E293B' }}>Nenhuma conversa ainda</p>
              ) : (
                <div className="space-y-3">
                  {groupByDate(sessions).map(group => (
                    <div key={group.label}>
                      <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: '#1E3251' }}>{group.label}</p>
                      <div className="space-y-0.5">
                        {group.items.map(s => (
                          <SessionItem key={s.session_id} session={s}
                            active={activeSession?.session_id === s.session_id}
                            onClick={() => selectSession(s.session_id)}
                            onDelete={(e) => deleteSession(s.session_id, e)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-3 py-2.5 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <p className="text-[10px] text-center" style={{ color: '#1E293B' }}>Powered by Gemini 2.5 Flash</p>
            </div>
          </div>
        </aside>

        {/* ── Main area ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 relative">

          {/* orbs */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
            <div className="absolute" style={{ top: '-20%', right: '-10%', width: '40vw', height: '40vw', background: 'rgba(4,126,169,0.04)', borderRadius: '50%', filter: 'blur(80px)' }} />
            <div className="absolute" style={{ bottom: '-10%', left: '20%', width: '30vw', height: '30vw', background: 'rgba(192,255,125,0.025)', borderRadius: '50%', filter: 'blur(100px)' }} />
          </div>

          {/* Header */}
          <div className="shrink-0 relative z-10 flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(10,19,32,0.65)', backdropFilter: 'blur(16px)' }}>

            <button onClick={() => setSidebarOpen(v => !v)}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
              style={{ color: '#475569' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#475569'; (e.currentTarget as HTMLElement).style.background = ''; }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <input ref={titleInputRef} value={titleDraft}
                  className="bg-transparent text-sm font-semibold text-white outline-none w-full pb-0.5"
                  style={{ borderBottom: '1px solid rgba(0,190,255,0.5)' }}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (activeSession && titleDraft.trim()) renameSession(activeSession.session_id, titleDraft.trim());
                    setEditingTitle(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                  autoFocus />
              ) : (
                <button onClick={() => { if (activeSession) { setTitleDraft(activeSession.title); setEditingTitle(true); } }}
                  className="text-sm font-semibold text-white truncate max-w-sm text-left transition-opacity hover:opacity-70">
                  {activeSession?.title ?? 'Chat IA'}
                </button>
              )}
              {activeSession?.edital_id && (
                <Link href={`/edital/${activeSession.edital_id}`}
                  className="inline-flex items-center gap-1 mt-0.5 text-[10px] transition-opacity hover:opacity-70"
                  style={{ color: '#00BEFF' }}>
                  <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  ver edital
                </Link>
              )}
            </div>

            {activeSession && (
              <button onClick={(e) => deleteSession(activeSession.session_id, e)} title="Deletar"
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0"
                style={{ color: '#334155' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#334155'; (e.currentTarget as HTMLElement).style.background = ''; }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 relative z-10 overflow-y-auto chat-scroller px-6 py-6 space-y-5">
            {!activeSession ? (
              <div className="flex flex-col items-center justify-center h-full pb-20 text-center gap-5">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(4,126,169,0.12)', border: '1px solid rgba(0,190,255,0.15)' }}>
                  <svg className="w-8 h-8" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div>
                  <h2 className="font-poppins font-bold text-xl text-white mb-2">Bem-vindo ao Chat IA</h2>
                  <p className="text-sm max-w-xs mx-auto" style={{ color: '#475569' }}>Crie uma nova conversa para começar.</p>
                </div>
                <button onClick={() => createSession()}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(135deg,#047EA9,#00BEFF)', boxShadow: '0 4px 20px rgba(0,190,255,0.25)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 28px rgba(0,190,255,0.4)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,190,255,0.25)'; }}>
                  Nova conversa
                </button>
              </div>
            ) : isEmpty ? (
              hasEdital
                ? <EditalWelcomeCard onAction={(text) => sendMessage(text)} />
                : <GeneralWelcome onSelect={(q) => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }} />
            ) : (
              <>
                {messages.map((msg, i) => <MessageBubble key={msg.message_id ?? `msg-${i}`} msg={msg} />)}
                <div ref={messagesEndRef} />
              </>
            )}

            {error && (
              <div className="rounded-xl px-4 py-3 text-xs flex items-center gap-2.5"
                style={{ background: 'rgba(225,72,73,0.08)', border: '1px solid rgba(225,72,73,0.2)', color: '#FCA5A5' }}>
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 text-base leading-none">×</button>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="shrink-0 relative z-10 px-4 pb-4 pt-3 transition-all duration-200"
            style={{
              borderTop: isDragging ? '1px solid rgba(0,190,255,0.4)' : '1px solid rgba(255,255,255,0.05)',
              background: isDragging ? 'rgba(0,190,255,0.04)' : 'rgba(10,19,32,0.72)',
              backdropFilter: 'blur(16px)',
            }}>

            {isDragging && (
              <div className="text-center text-xs mb-3 py-2 rounded-lg"
                style={{ color: '#00BEFF', background: 'rgba(0,190,255,0.06)', border: '1px dashed rgba(0,190,255,0.3)' }}>
                Solte o arquivo aqui — imagens, PDF ou texto
              </div>
            )}

            {pendingFiles.length > 0 && (
              <div className="mb-3 space-y-2">
                {hasPdfPending && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: 'rgba(192,255,125,0.04)', border: '1px solid rgba(192,255,125,0.2)' }}>
                    <svg className="w-4 h-4 shrink-0" style={{ color: '#C0FF7D' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                    <p className="flex-1 text-xs" style={{ color: '#64748B' }}>
                      É um <strong style={{ color: '#C0FF7D' }}>edital?</strong> Análise completa: aptidão, atestados, gaps.
                    </p>
                    <button
                      onClick={() => {
                        const pf = pendingFiles.find(f => f.file.type === 'application/pdf');
                        if (pf) { removeFile(pf.id); uploadEditalFile(pf.file); }
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
                      style={{ background: 'rgba(192,255,125,0.15)', color: '#C0FF7D', border: '1px solid rgba(192,255,125,0.3)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(192,255,125,0.25)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(192,255,125,0.15)'; }}>
                      Analisar edital ↗
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map(pf => (
                    <div key={pf.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs"
                      style={{ background: 'rgba(0,190,255,0.07)', border: '1px solid rgba(0,190,255,0.2)' }}>
                      {pf.file.type.startsWith('image/') ? (
                        <img src={pf.localUrl} alt="" className="w-6 h-6 rounded-lg object-cover shrink-0" />
                      ) : (
                        <svg className="w-4 h-4 shrink-0" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      <span className="max-w-[120px] truncate" style={{ color: '#CBD5E1' }}>{pf.file.name}</span>
                      <span style={{ color: '#334155' }}>{fmtSize(pf.file.size)}</span>
                      <button onClick={() => removeFile(pf.id)} className="text-slate-600 hover:text-red-400 transition-colors leading-none ml-0.5">×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-end gap-2.5">
              <button onClick={() => fileInputRef.current?.click()} disabled={sending}
                title="Anexar (imagem, PDF, texto)"
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-30"
                style={{ color: '#475569', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#00BEFF'; el.style.borderColor = 'rgba(0,190,255,0.3)'; el.style.background = 'rgba(0,190,255,0.05)'; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#475569'; el.style.borderColor = 'rgba(255,255,255,0.06)'; el.style.background = 'rgba(255,255,255,0.02)'; }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,text/plain"
                className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />

              <div className="flex-1 relative">
                <textarea ref={inputRef} value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={activeSession ? 'Pergunte ou arraste um arquivo…' : 'Crie uma nova conversa para começar…'}
                  rows={1} disabled={sending || !activeSession}
                  className="chat-textarea w-full resize-none rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all disabled:opacity-40"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${canSend ? 'rgba(0,190,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    maxHeight: '160px', lineHeight: '1.6',
                    boxShadow: canSend ? '0 0 0 3px rgba(0,190,255,0.06)' : undefined,
                  }}
                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }} />
              </div>

              <button onClick={() => sendMessage()} disabled={!canSend || !activeSession}
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200"
                style={{
                  background: canSend && activeSession ? 'linear-gradient(135deg,#047EA9,#00BEFF)' : 'rgba(255,255,255,0.05)',
                  boxShadow: canSend && activeSession ? '0 4px 20px rgba(0,190,255,0.3)' : undefined,
                  opacity: !activeSession ? 0.3 : 1,
                }}
                onMouseEnter={e => { if (canSend) (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 28px rgba(0,190,255,0.5)'; }}
                onMouseLeave={e => { if (canSend) (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,190,255,0.3)'; }}>
                {sending ? (
                  <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>

            <p className="text-center text-[10px] mt-2.5" style={{ color: 'rgba(51,65,85,0.7)' }}>
              Enter para enviar · Shift+Enter nova linha · Arraste imagens e PDFs
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────
export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-8 h-8 animate-spin" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm" style={{ color: '#475569' }}>Carregando chat…</span>
        </div>
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  );
}
