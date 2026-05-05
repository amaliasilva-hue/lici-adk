'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Notification = {
  notification_id: string;
  type: string;
  title: string;
  body?: string;
  entity_type?: string;
  entity_id?: string;
  read_at?: string | null;
  created_at: string;
};

// Pull user email from env or default to a shared inbox for demo
const USER_EMAIL = process.env.NEXT_PUBLIC_NOTIFY_EMAIL || '';

function entityLink(n: Notification): string | null {
  if (n.entity_type === 'edital' && n.entity_id) return `/edital/${n.entity_id}`;
  return null;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function NotificationBell({ userEmail }: { userEmail?: string }) {
  const email = userEmail || USER_EMAIL;
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function fetchNotifications() {
    if (!email) return;
    try {
      const r = await fetch(`/api/proxy/notifications?user_email=${encodeURIComponent(email)}&limit=20`);
      if (!r.ok) return;
      const data: Notification[] = await r.json();
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.read_at).length);
    } catch {}
  }

  async function markAllRead() {
    if (!email) return;
    try {
      await fetch(`/api/proxy/notifications/read?user_email=${encodeURIComponent(email)}`, { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch {}
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [email]); // eslint-disable-line react-hooks/exhaustive-deps

  // close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleOpen() {
    setOpen(o => !o);
    if (!open && unreadCount > 0) markAllRead();
  }

  if (!email) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
        aria-label="Notificações"
      >
        {/* Bell icon */}
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold text-white px-0.5"
            style={{ background: '#E14849', boxShadow: '0 0 8px rgba(225,72,73,0.35)' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 rounded-2xl shadow-xl z-[200] overflow-hidden"
          style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.09)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-800">Notificações</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors">
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400">
                Nenhuma notificação
              </div>
            ) : (
              notifications.map(n => {
                const link = entityLink(n);
                const isUnread = !n.read_at;
                const inner = (
                  <div className={`px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer flex gap-3 ${isUnread ? 'bg-blue-50/30' : ''}`}>
                    <div className="mt-0.5 shrink-0">
                      {n.type === 'analysis_done' ? (
                        <span className="text-base">✅</span>
                      ) : n.type === 'comment' ? (
                        <span className="text-base">💬</span>
                      ) : n.type === 'alert' ? (
                        <span className="text-base">⚠️</span>
                      ) : (
                        <span className="text-base">🔔</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug ${isUnread ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{n.body}</p>}
                      <p className="text-[10px] text-slate-300 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {isUnread && (
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: '#047EA9' }} />
                    )}
                  </div>
                );
                return link ? (
                  <Link key={n.notification_id} href={link} onClick={() => setOpen(false)}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.notification_id}>{inner}</div>
                );
              })
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100">
            <p className="text-[10px] text-slate-300 text-center">Atualiza a cada 30s</p>
          </div>
        </div>
      )}
    </div>
  );
}
