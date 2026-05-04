'use client';
import { useState, useCallback } from 'react';
import Link from 'next/link';
import NavLinks from './nav-links';
import NotificationBell from './notification-bell';
import ChatWidget from './chat-widget';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="sidebar-shell"
        data-collapsed={collapsed ? 'true' : undefined}
      >
        {/* Logo + toggle */}
        <div className="sidebar-logo">
          <Link href="/" className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            {/* X symbol — always visible */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png"
              alt="Xertica"
              className="h-7 w-7 object-contain flex-shrink-0"
            />
            {/* Full wordmark — hidden on mobile and when collapsed */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/xertica.ai/Copy%20of%20Logo_XERTICA_white.png"
              alt="Xertica"
              className="sidebar-wordmark h-[18px] w-auto flex-shrink-0"
            />
          </Link>

          {/* Collapse toggle — desktop only */}
          <button
            type="button"
            onClick={toggle}
            className="sidebar-toggle-btn"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-5 px-3 overflow-y-auto custom-scrollbar">
          <NavLinks />
        </nav>

        {/* User profile */}
        <div className="sidebar-user">
          <div className="sidebar-avatar shrink-0">XE</div>
          <div className="sidebar-user-info">
            <span className="text-sm font-semibold text-white truncate leading-tight block">Xertica Enterprise</span>
            <span className="text-[10px] text-slate-400 font-mono">B2G Intelligence</span>
          </div>
        </div>
      </aside>

      {/* ── Main Area ───────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header */}
        <header className="app-header">
          <h1 className="font-heading font-bold text-[17px] text-slate-800 hidden md:block truncate shrink-0 tracking-tight">
            Sales Intelligence Hub
          </h1>

          {/* Central search trigger (opens CMD+K palette) */}
          <button
            type="button"
            className="header-search-trigger flex-1 max-w-lg mx-4 hidden sm:flex"
            onClick={() => document.dispatchEvent(new CustomEvent('openCmdPalette'))}
          >
            <div className="flex items-center gap-3 w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 hover:border-[#047EA9] hover:bg-white transition-all duration-150 shadow-sm cursor-text">
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <span className="text-sm text-slate-400 flex-1 text-left">Buscar editais, órgãos, processos…</span>
              <kbd className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-400 shadow-sm hidden lg:inline">⌘K</kbd>
            </div>
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-3 ml-auto sm:ml-0 shrink-0">
            <Link href="/chat" className="copilot-btn">
              {/* Sparkles */}
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
              </svg>
              Co-pilot AI
            </Link>
            <NotificationBell />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-app">
          {children}
        </main>
      </div>

      <ChatWidget />
    </div>
  );
}
