'use client';
import { Suspense } from 'react';
import {
  useCallback, useEffect, useRef, useState, useTransition,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'user' | 'assistant';

interface Attachment {
  filename: string;
  mime_type: string;
  size: number;
  localUrl?: string;   // for image preview
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
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function MdContent({ content }: { content: string }) {
  return (
    <ReactMarkdown components={{
      p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">{children}</a>
      ),
      ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1.5 text-slate-300">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1.5 text-slate-300">{children}</ol>,
      li: ({ children }) => <li>{children}</li>,
      h1: ({ children }) => <h1 className="font-bold text-white text-base mt-3 mb-1.5">{children}</h1>,
      h2: ({ children }) => <h2 className="font-semibold text-white/80 text-sm uppercase tracking-wider mt-3 mb-1">{children}</h2>,
      h3: ({ children }) => <h3 className="font-semibold text-white text-sm mt-2 mb-0.5">{children}</h3>,
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-cyan-500 pl-3 italic text-slate-400 my-2">{children}</blockquote>
      ),
      code: ({ children, className }) => (
        className?.includes('language-')
          ? <pre className="bg-black/50 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto my-2 border border-white/10"><code>{children}</code></pre>
          : <code className="bg-black/40 text-cyan-300 rounded px-1.5 py-0.5 text-[11px] font-mono">{children}</code>
      ),
      table: ({ children }) => (
        <div className="overflow-x-auto my-3">
          <table className="w-full text-xs border-collapse">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="text-left text-slate-400 border-b border-white/10 pb-1.5 pr-4 font-medium uppercase tracking-wider text-[10px]">{children}</th>,
      td: ({ children }) => <td className="py-1.5 pr-4 border-b border-white/[0.04] text-slate-300">{children}</td>,
      hr: () => <hr className="border-white/[0.08] my-3" />,
    }}>
      {content}
    </ReactMarkdown>
  );
}

// ─── Animated dots ────────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-2 h-2 rounded-full bg-cyan-400/60"
          style={{ animation: `chatDot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const isPending = msg.pending;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-end`}
      style={{ animation: 'chatMsgIn 0.25s cubic-bezier(0.16,1,0.3,1) both' }}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#047EA9,#00BEFF)' }}>
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
      )}

      {/* Bubble */}
      <div className={`max-w-[80%] flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* File attachments (user only) */}
        {msg.attachments_meta && msg.attachments_meta.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {msg.attachments_meta.map((a, i) => (
              a.mime_type.startsWith('image/') && a.localUrl ? (
                <img key={i} src={a.localUrl} alt={a.filename}
                  className="max-h-40 max-w-xs rounded-xl object-cover border border-white/10" />
              ) : (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <svg className="w-4 h-4 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-slate-300 max-w-[160px] truncate">{a.filename}</span>
                  <span className="text-slate-600 shrink-0">{fmtSize(a.size)}</span>
                </div>
              )
            ))}
          </div>
        )}

        {/* Text bubble */}
        <div className={`rounded-2xl px-4 py-3 text-sm ${isUser ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
          style={isUser ? {
            background: 'linear-gradient(135deg,#047EA9,#0590C0)',
            color: 'rgba(255,255,255,0.95)',
            boxShadow: '0 4px 20px rgba(4,126,169,0.3)',
          } : {
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            color: '#CBD5E1',
          }}>
          {isPending ? <ThinkingDots /> : (
            isUser
              ? <p className="leading-relaxed whitespace-pre-wrap">{msg.content.replace(/^\[Arquivos:.*?\]\n/, '')}</p>
              : <MdContent content={msg.content} />
          )}
        </div>

        {/* Timestamp */}
        {msg.created_at && !isPending && (
          <span className="text-[10px] text-slate-700 px-1">{fmtDate(msg.created_at)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Session item ─────────────────────────────────────────────────────────────
function SessionItem({ session, active, onClick, onDelete }: {
  session: Session;
  active: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 group relative ${
        active ? 'bg-cyan-500/10 border border-cyan-500/20' : 'hover:bg-white/[0.04] border border-transparent'
      }`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs font-medium line-clamp-1 ${active ? 'text-white' : 'text-slate-300'}`}>
          {session.title}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {session.edital_id && (
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" title="Vinculado a edital" />
          )}
          <span className="text-[10px] text-slate-600">{fmtDate(session.updated_at)}</span>
          <button onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400 transition-all p-0.5"
            title="Deletar">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {session.last_message && (
        <p className="text-[11px] text-slate-600 line-clamp-1 mt-0.5">
          {session.last_message.replace(/^\[Arquivos:.*?\]\n/, '')}
        </p>
      )}
    </button>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
function ChatPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Input state
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

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Handle ?edital= param → auto-create session linked to edital
  useEffect(() => {
    const editalId = params.get('edital');
    if (!editalId || sessions.length === 0) return;
    // Check if we already have a session for this edital open
    const existing = sessions.find(s => s.edital_id === editalId);
    if (existing) {
      selectSession(existing.session_id);
    } else {
      // Create new session linked to edital
      createSession(editalId).then(() => {
        // remove param from URL
        router.replace('/chat');
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, sessions.length]);

  async function loadSessions() {
    try {
      const r = await fetch('/api/proxy/chat/sessions?limit=60');
      if (r.ok) {
        const data: Session[] = await r.json();
        setSessions(data);
        // Auto-select first if none active
        if (data.length > 0 && !activeSession) {
          selectSession(data[0].session_id);
        }
      }
    } catch {}
  }

  async function selectSession(sessionId: string) {
    try {
      const r = await fetch(`/api/proxy/chat/sessions/${sessionId}`);
      if (r.ok) {
        const data: Session = await r.json();
        startTransition(() => setActiveSession(data));
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch {}
  }

  async function createSession(editalId?: string) {
    const title = editalId ? 'Conversa sobre edital' : 'Nova conversa';
    const qs = new URLSearchParams({ title });
    if (editalId) qs.set('edital_id', editalId);
    const r = await fetch(`/api/proxy/chat/sessions?${qs}`, { method: 'POST' });
    if (r.ok) {
      const newSession: Session = await r.json();
      newSession.messages = [];
      setSessions(prev => [newSession, ...prev]);
      setActiveSession(newSession);
      setTimeout(() => inputRef.current?.focus(), 100);
      return newSession;
    }
    return null;
  }

  async function deleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/proxy/chat/sessions/${sessionId}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.session_id !== sessionId));
    if (activeSession?.session_id === sessionId) {
      setActiveSession(null);
    }
  }

  async function renameSession(sessionId: string, title: string) {
    await fetch(`/api/proxy/chat/sessions/${sessionId}/title?title=${encodeURIComponent(title)}`, { method: 'PATCH' });
    setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, title } : s));
    setActiveSession(prev => prev?.session_id === sessionId ? { ...prev, title } : prev);
  }

  // File handling
  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const allowed = ['image/', 'application/pdf', 'text/plain'];
    const valid = arr.filter(f => allowed.some(a => f.type.startsWith(a)));
    const newPending: PendingFile[] = valid.map(f => ({
      file: f,
      localUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      id: uid(),
    }));
    setPendingFiles(prev => [...prev, ...newPending]);
  }

  function removeFile(id: string) {
    setPendingFiles(prev => {
      const f = prev.find(p => p.id === id);
      if (f?.localUrl) URL.revokeObjectURL(f.localUrl);
      return prev.filter(p => p.id !== id);
    });
  }

  // Send message
  async function sendMessage() {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (sending) return;

    let session = activeSession;
    if (!session) {
      session = await createSession();
      if (!session) return;
    }

    const sid = session.session_id;

    // Optimistic: add user message immediately
    const optimisticAttachments: Attachment[] = pendingFiles.map(p => ({
      filename: p.file.name,
      mime_type: p.file.type,
      size: p.file.size,
      localUrl: p.localUrl,
    }));

    const userMsg: ChatMessage = {
      role: 'user',
      content: text || '(arquivo)',
      attachments_meta: optimisticAttachments.length > 0 ? optimisticAttachments : undefined,
      created_at: new Date().toISOString(),
    };
    const pendingMsg: ChatMessage = { role: 'assistant', content: '', pending: true };

    setActiveSession(prev => prev ? {
      ...prev,
      messages: [...(prev.messages ?? []), userMsg, pendingMsg],
    } : prev);

    const capturedFiles = [...pendingFiles];
    setInput('');
    setPendingFiles([]);
    setSending(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('text', text || '(arquivo)');
      for (const pf of capturedFiles) {
        form.append('files', pf.file, pf.file.name);
      }

      const r = await fetch(`/api/proxy/chat/sessions/${sid}/messages`, {
        method: 'POST',
        body: form,
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.detail || `Erro ${r.status}`);
      }

      const data = await r.json();
      const reply = data.reply as string;
      const replyMsg: ChatMessage = {
        message_id: data.message_id,
        role: 'assistant',
        content: reply,
        created_at: new Date().toISOString(),
      };

      startTransition(() => {
        setActiveSession(prev => {
          if (!prev) return prev;
          const msgs = (prev.messages ?? []).filter(m => !m.pending);
          return { ...prev, messages: [...msgs, replyMsg] };
        });
        // Update last_message preview in sidebar
        setSessions(prev => prev.map(s =>
          s.session_id === sid
            ? { ...s, last_message: reply.slice(0, 80), updated_at: new Date().toISOString() }
            : s
        ));
        // If first message, reload sessions to get auto-title
        if ((session?.messages ?? []).length === 0) {
          setTimeout(loadSessions, 800);
        }
      });

      // Revoke object URLs
      capturedFiles.forEach(f => { if (f.localUrl) URL.revokeObjectURL(f.localUrl); });
    } catch (e: any) {
      setError(e.message || 'Falha ao enviar mensagem');
      // Remove optimistic messages
      setActiveSession(prev => prev ? {
        ...prev,
        messages: (prev.messages ?? []).filter(m => !m.pending && m !== userMsg),
      } : prev);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // Drag & drop
  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave()                   { setIsDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const messages = activeSession?.messages ?? [];
  const isEmpty = messages.length === 0;

  return (
    <>
      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%            { transform: scale(1.1); opacity: 1; }
        }
        @keyframes chatMsgIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .chat-page-scroller::-webkit-scrollbar { width: 4px; }
        .chat-page-scroller::-webkit-scrollbar-track { background: transparent; }
        .chat-page-scroller::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
      `}</style>

      <div className="flex h-[calc(100vh-64px)] -mt-4 -mx-4 sm:-mx-6 overflow-hidden">

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className={`shrink-0 flex flex-col border-r transition-all duration-300 ${
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        }`} style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}>

          <div className="px-3 py-3 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <button onClick={() => createSession()}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.5),rgba(0,190,255,0.3))', border: '1px solid rgba(0,190,255,0.3)' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nova conversa
            </button>
          </div>

          <div className="flex-1 overflow-y-auto chat-page-scroller px-2 py-2 space-y-0.5">
            {sessions.length === 0 ? (
              <p className="text-[11px] text-slate-700 text-center py-6">Nenhuma conversa ainda</p>
            ) : (
              sessions.map(s => (
                <SessionItem
                  key={s.session_id}
                  session={s}
                  active={activeSession?.session_id === s.session_id}
                  onClick={() => selectSession(s.session_id)}
                  onDelete={(e) => deleteSession(s.session_id, e)}
                />
              ))
            )}
          </div>
        </aside>

        {/* ── Main chat area ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

          {/* Chat header */}
          <div className="shrink-0 border-b px-4 py-3 flex items-center gap-3"
            style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.1)' }}>

            {/* Sidebar toggle */}
            <button onClick={() => setSidebarOpen(v => !v)}
              className="text-slate-600 hover:text-slate-400 transition-colors p-1 rounded-lg hover:bg-white/[0.04]">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Title (editable) */}
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <input ref={titleInputRef} value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (activeSession && titleDraft.trim()) renameSession(activeSession.session_id, titleDraft.trim());
                    setEditingTitle(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                  className="bg-transparent text-white text-sm font-semibold outline-none border-b border-cyan-500 w-full pb-0.5"
                  autoFocus
                />
              ) : (
                <button onClick={() => {
                  if (activeSession) { setTitleDraft(activeSession.title); setEditingTitle(true); }
                }}
                  className="text-sm font-semibold text-white hover:text-cyan-300 transition-colors truncate max-w-full text-left">
                  {activeSession?.title ?? 'Chat IA'}
                </button>
              )}
              {activeSession?.edital_id && (
                <span className="text-[10px] text-cyan-500 flex items-center gap-1 mt-0.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  vinculado a edital
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              {activeSession && (
                <button onClick={() => deleteSession(activeSession.session_id, {} as React.MouseEvent)}
                  title="Deletar conversa"
                  className="text-slate-700 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/[0.04] transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto chat-page-scroller px-6 py-6 space-y-5">
            {!activeSession ? (
              /* Welcome state — no session */
              <div className="flex flex-col items-center justify-center h-full text-center gap-4 pb-20">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,rgba(4,126,169,0.25),rgba(0,190,255,0.15))', border: '1px solid rgba(0,190,255,0.2)' }}>
                  <svg className="w-8 h-8" style={{ color: '#00BEFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-white font-semibold text-lg mb-1">Chat com IA da Xertica</h2>
                  <p className="text-slate-500 text-sm max-w-md">
                    Pergunte sobre atestados, contratos, certificações ou anexe documentos para análise.
                    O assistente consulta a base de dados em tempo real.
                  </p>
                </div>
                <button onClick={() => createSession()}
                  className="mt-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: 'linear-gradient(135deg,#047EA9,#00BEFF)', boxShadow: '0 4px 20px rgba(0,190,255,0.3)' }}>
                  Iniciar conversa
                </button>
              </div>
            ) : isEmpty ? (
              /* Empty session — show suggestions */
              <div className="flex flex-col items-center justify-center h-full pb-10">
                <p className="text-slate-700 text-xs uppercase tracking-widest mb-4">Sugestões para começar</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
                  {[
                    'Para quais órgãos temos atestados de GCP?',
                    'Quais contratos não têm atestado formal?',
                    'Temos atestados de IA ou machine learning?',
                    'Mostre os 10 órgãos com mais atestados',
                    'Certificações vigentes em Cloud que temos?',
                    'Análises APTO nos últimos 30 dias',
                  ].map((q, i) => (
                    <button key={i} onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="text-left text-xs text-slate-400 hover:text-white px-4 py-3 rounded-xl transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(0,190,255,0.06)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,190,255,0.2)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
                      }}>
                      <span className="opacity-30 mr-2">→</span>{q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Messages list */
              <>
                {messages.map((msg, i) => (
                  <MessageBubble key={msg.message_id ?? `msg-${i}`} msg={msg} />
                ))}
                <div ref={messagesEndRef} />
              </>
            )}

            {/* Error banner */}
            {error && (
              <div className="rounded-xl px-4 py-3 text-xs flex items-center gap-2"
                style={{ background: 'rgba(225,72,73,0.1)', border: '1px solid rgba(225,72,73,0.25)', color: '#FCA5A5' }}>
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                {error}
                <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">×</button>
              </div>
            )}
          </div>

          {/* ── Input area ─────────────────────────────────────────── */}
          <div className="shrink-0 border-t px-4 pb-4 pt-3"
            style={{
              borderColor: isDragging ? 'rgba(0,190,255,0.4)' : 'rgba(255,255,255,0.06)',
              background: isDragging ? 'rgba(0,190,255,0.04)' : 'rgba(0,0,0,0.15)',
              transition: 'all 0.2s',
            }}>

            {isDragging && (
              <p className="text-center text-xs text-cyan-400 mb-2">
                Solte o arquivo aqui (imagens, PDF, texto)
              </p>
            )}

            {/* Pending files */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pendingFiles.map(pf => (
                  <div key={pf.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                    style={{ background: 'rgba(0,190,255,0.1)', border: '1px solid rgba(0,190,255,0.25)' }}>
                    {pf.file.type.startsWith('image/') ? (
                      <img src={pf.localUrl} alt="" className="w-5 h-5 rounded object-cover" />
                    ) : (
                      <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <span className="text-cyan-300 max-w-[120px] truncate">{pf.file.name}</span>
                    <span className="text-cyan-600">{fmtSize(pf.file.size)}</span>
                    <button onClick={() => removeFile(pf.id)} className="text-cyan-600 hover:text-red-400 ml-0.5">×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* File attach */}
              <button onClick={() => fileInputRef.current?.click()}
                title="Anexar arquivo (imagem, PDF, texto)"
                disabled={sending}
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-slate-600 hover:text-cyan-400 hover:bg-white/[0.04] transition-all disabled:opacity-30">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,text/plain"
                className="hidden"
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              />

              {/* Textarea */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={activeSession ? 'Pergunte ou anexe um arquivo…' : 'Clique em "Nova conversa" ou inicie…'}
                rows={1}
                disabled={sending || !activeSession}
                className="flex-1 resize-none rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all custom-scrollbar disabled:opacity-40"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${input || pendingFiles.length > 0 ? 'rgba(0,190,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  maxHeight: '140px',
                  lineHeight: '1.5',
                  boxShadow: input || pendingFiles.length > 0 ? '0 0 0 2px rgba(0,190,255,0.08)' : undefined,
                }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
                }}
              />

              {/* Send button */}
              <button
                onClick={sendMessage}
                disabled={sending || (!input.trim() && pendingFiles.length === 0) || !activeSession}
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 disabled:opacity-25"
                style={{
                  background: (input.trim() || pendingFiles.length > 0) && activeSession && !sending
                    ? 'linear-gradient(135deg,#047EA9,#00BEFF)'
                    : 'rgba(255,255,255,0.06)',
                  boxShadow: (input.trim() || pendingFiles.length > 0) && !sending ? '0 4px 16px rgba(0,190,255,0.25)' : undefined,
                }}>
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

            <p className="text-[10px] text-slate-700 mt-1.5 text-center">
              Enter para enviar · Shift+Enter quebra linha · Arraste arquivos aqui
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400 text-sm">Carregando…</div>}>
      <ChatPageInner />
    </Suspense>
  );
}
