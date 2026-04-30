'use client';
import {
  useEffect, useRef, useState, useCallback, useTransition,
} from 'react';
import ReactMarkdown from 'react-markdown';

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'user' | 'assistant';
type Msg = { role: Role; content: string; id: string };

// ─── Suggested prompts (context-aware starters) ───────────────────────────────
const SUGGESTED = [
  'Para quais órgãos temos atestados de GCP?',
  'Quais contratos não têm atestado formal e posso solicitar?',
  'Mostre os 10 órgãos com mais atestados',
  'Temos atestado de IA / machine learning?',
  'Como comprovar experiência em Google Workspace para licitação?',
  'Quais análises foram APTO nos últimos 30 dias?',
  'Editais com score acima de 70 no pipeline',
  'Certificações vigentes em Cloud que temos?',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatTime(d: Date) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Markdown renderer (inline + block) ──────────────────────────────────────
function MdContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary-400 underline underline-offset-2 hover:text-primary-300">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1.5">{children}</ol>,
        li: ({ children }) => <li className="text-slate-300">{children}</li>,
        h1: ({ children }) => <h1 className="font-poppins font-bold text-white text-sm mt-2 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="font-poppins font-semibold text-white text-xs uppercase tracking-wider mt-2 mb-1 opacity-75">{children}</h2>,
        h3: ({ children }) => <h3 className="font-semibold text-white text-xs mt-1.5 mb-0.5">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary-500 pl-3 italic text-slate-400 my-1.5">{children}</blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-');
          return isBlock ? (
            <pre className="bg-black/40 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto my-1.5 border border-white/10">
              <code>{children}</code>
            </pre>
          ) : (
            <code className="bg-black/30 text-primary-300 rounded px-1 py-0.5 text-[11px] font-mono">{children}</code>
          );
        },
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="w-full text-xs border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead>{children}</thead>,
        th: ({ children }) => (
          <th className="text-left text-slate-400 border-b border-white/10 pb-1 pr-3 font-normal uppercase tracking-wider text-[10px]">{children}</th>
        ),
        td: ({ children }) => (
          <td className="py-1 pr-3 border-b border-white/[0.04] text-slate-300">{children}</td>
        ),
        hr: () => <hr className="border-white/[0.08] my-2" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ─── Loading dots ─────────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary-400 opacity-60"
          style={{ animation: `chatDot 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [serverHistory, setServerHistory] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [, startTransition] = useTransition();

  // Auto-scroll
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open]);

  // Keyboard shortcut: Ctrl+K to toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Msg = { role: 'user', content: trimmed, id: uid() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setError(null);
    setLoading(true);

    const nextHistory = [...serverHistory, { role: 'user', content: trimmed }];

    try {
      const res = await fetch('/api/proxy/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextHistory }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || `Erro ${res.status}`);
      }

      const data = await res.json();
      const reply = data.reply as string;
      const assistantMsg: Msg = { role: 'assistant', content: reply, id: uid() };

      startTransition(() => {
        setMessages((prev) => [...prev, assistantMsg]);
        setServerHistory(data.messages ?? [...nextHistory, { role: 'assistant', content: reply }]);
        if (!open) setUnread((n) => n + 1);
      });
    } catch (e: any) {
      setError(e.message || 'Falha ao conectar ao assistente');
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    } finally {
      setLoading(false);
    }
  }, [loading, open, serverHistory]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearChat() {
    setMessages([]);
    setServerHistory([]);
    setError(null);
    setUnread(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Inline styles for animations that can't be in Tailwind ── */}
      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%            { transform: scale(1.1); opacity: 1; }
        }
        @keyframes chatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,190,255,0.4); }
          50%       { box-shadow: 0 0 0 8px rgba(0,190,255,0); }
        }
        @keyframes chatWidgetIn {
          0%   { opacity: 0; transform: scale(0.92) translateY(16px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes chatWidgetOut {
          0%   { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(0.92) translateY(16px); }
        }
        @keyframes chatMsgIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .chat-widget-open  { animation: chatWidgetIn  0.28s cubic-bezier(0.16,1,0.3,1) forwards; }
        .chat-widget-close { animation: chatWidgetOut 0.22s ease-in forwards; }
        .chat-msg-in       { animation: chatMsgIn     0.25s cubic-bezier(0.16,1,0.3,1) both; }
        .chat-fab-pulse    { animation: chatPulse 2.5s ease-in-out infinite; }
      `}</style>

      {/* ── FAB Button ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir assistente de licitações"
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl transition-all duration-300 ${
          open
            ? 'rotate-0 scale-100'
            : 'hover:scale-105 hover:-translate-y-0.5 chat-fab-pulse'
        }`}
        style={{
          background: open
            ? 'linear-gradient(135deg,#0A1320,#14263D)'
            : 'linear-gradient(135deg,#047EA9,#00BEFF)',
          border: open ? '1px solid rgba(255,255,255,0.12)' : 'none',
          boxShadow: open
            ? '0 8px 32px rgba(0,0,0,0.4)'
            : '0 8px 32px rgba(0,190,255,0.35), 0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        {open ? (
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center border-2 border-[#0A1320]">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </>
        )}
      </button>

      {/* ── Chat Panel ── */}
      {open && (
        <div
          className="chat-widget-open fixed bottom-24 right-6 z-50 flex flex-col rounded-2xl overflow-hidden"
          style={{
            width: 'min(420px, calc(100vw - 24px))',
            height: 'min(620px, calc(100vh - 120px))',
            background: 'linear-gradient(180deg, rgba(14,26,42,0.97) 0%, rgba(10,19,32,0.98) 100%)',
            border: '1px solid rgba(0,190,255,0.2)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,190,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
            backdropFilter: 'blur(32px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#047EA9,#00BEFF)' }}>
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#0E1A2A]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-none">Assistente Lici</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Atestados · Contratos · Pipeline</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-slate-600 border border-white/[0.08] rounded font-mono">
                Ctrl K
              </kbd>
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  title="Limpar conversa"
                  className="text-slate-600 hover:text-slate-400 p-1 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Messages / Empty state */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
            {isEmpty ? (
              <div className="flex flex-col h-full">
                {/* Welcome */}
                <div className="flex flex-col items-center text-center pt-4 pb-5">
                  <div className="w-14 h-14 rounded-2xl mb-3 flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.3),rgba(0,190,255,0.15))', border: '1px solid rgba(0,190,255,0.25)' }}>
                    <svg className="w-7 h-7" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-white font-semibold text-sm mb-1">Assistente de Atestados</p>
                  <p className="text-slate-500 text-xs leading-relaxed max-w-xs">
                    Pergunte sobre atestados, contratos, certificações e análises. Consulto os dados em tempo real.
                  </p>
                </div>

                {/* Suggested prompts */}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-slate-700 uppercase tracking-widest mb-2 text-center">Sugestões</p>
                  {SUGGESTED.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      className="w-full text-left text-xs text-slate-400 hover:text-white px-3 py-2.5 rounded-xl transition-all duration-200 group"
                      style={{
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,190,255,0.07)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,190,255,0.2)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.025)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.06)';
                      }}
                    >
                      <span className="mr-2 opacity-40">→</span>{q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div
                    key={msg.id}
                    className={`chat-msg-in flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    style={{ animationDelay: `${Math.min(i * 0.04, 0.2)}s` }}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-lg shrink-0 mr-2 mt-0.5 flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg,#047EA9,#00BEFF)' }}>
                        <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 010 2h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 010-2h1a7 7 0 017-7h1V5.73A2 2 0 0110 4a2 2 0 012-2zM7.5 13a4.5 4.5 0 100 9 4.5 4.5 0 000-9zm9 0a4.5 4.5 0 100 9 4.5 4.5 0 000-9z" />
                        </svg>
                      </div>
                    )}
                    <div
                      className="max-w-[84%] rounded-2xl px-3.5 py-2.5 text-xs"
                      style={
                        msg.role === 'user'
                          ? {
                              background: 'linear-gradient(135deg,#047EA9,#0590C0)',
                              color: 'rgba(255,255,255,0.92)',
                              borderBottomRightRadius: '4px',
                              boxShadow: '0 4px 16px rgba(4,126,169,0.35)',
                            }
                          : {
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.07)',
                              color: '#CBD5E1',
                              borderBottomLeftRadius: '4px',
                            }
                      }
                    >
                      {msg.role === 'assistant' ? (
                        <MdContent content={msg.content} />
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      )}
                      <p className="text-[9px] mt-1.5 opacity-30 text-right">{formatTime(new Date())}</p>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start chat-msg-in">
                    <div className="w-6 h-6 rounded-lg shrink-0 mr-2 mt-0.5 flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg,#047EA9,#00BEFF)' }}>
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 010 2h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 010-2h1a7 7 0 017-7h1V5.73A2 2 0 0110 4a2 2 0 012-2z" />
                      </svg>
                    </div>
                    <div className="rounded-2xl rounded-bl-sm"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <ThinkingDots />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="chat-msg-in rounded-xl px-3 py-2.5 text-xs"
                    style={{ background: 'rgba(225,72,73,0.1)', border: '1px solid rgba(225,72,73,0.3)', color: '#FCA5A5' }}>
                    <span className="mr-1.5">⚠</span>{error}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Input area */}
          <div className="shrink-0 px-3 py-3 border-t border-white/[0.06]"
            style={{ background: 'rgba(0,0,0,0.2)' }}>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte sobre atestados, contratos, análises…"
                rows={1}
                disabled={loading}
                className="flex-1 resize-none rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 outline-none transition-all custom-scrollbar disabled:opacity-50"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  maxHeight: '120px',
                  lineHeight: '1.5',
                  boxShadow: input ? '0 0 0 2px rgba(0,190,255,0.15)' : undefined,
                  borderColor: input ? 'rgba(0,190,255,0.3)' : 'rgba(255,255,255,0.09)',
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                aria-label="Enviar"
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-30"
                style={{
                  background: input.trim() && !loading
                    ? 'linear-gradient(135deg,#047EA9,#00BEFF)'
                    : 'rgba(255,255,255,0.06)',
                  boxShadow: input.trim() && !loading ? '0 4px 16px rgba(0,190,255,0.3)' : undefined,
                }}
              >
                {loading ? (
                  <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[9px] text-slate-700 mt-1.5 text-center">
              Enter para enviar · Shift+Enter para quebrar linha · Esc para fechar
            </p>
          </div>
        </div>
      )}
    </>
  );
}
