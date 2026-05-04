import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import ChatWidget from '@/components/chat-widget';
import NavLinks from '@/components/nav-links';
import NotificationBell from '@/components/notification-bell';

export const metadata: Metadata = {
  title: 'Licitações · Xertica',
  description: 'Análise de licitações públicas com IA agêntica',
  icons: {
    icon:  'https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png',
    apple: 'https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <div className="flex h-screen overflow-hidden">

          {/* ── Sidebar ── */}
          <aside className="sidebar-shell">
            {/* Logo */}
            <div className="sidebar-logo">
              <Link href="/" className="flex items-center gap-2.5 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png"
                  alt="X"
                  className="h-7 w-7 object-contain flex-shrink-0"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/xertica.ai/Copy%20of%20Logo_XERTICA_white.png"
                  alt="Xertica"
                  className="h-4 w-auto hidden lg:block opacity-90"
                />
              </Link>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-5 px-3 overflow-y-auto">
              <NavLinks />
            </nav>

            {/* User profile */}
            <div className="sidebar-user">
              <div className="sidebar-avatar shrink-0">XE</div>
              <div className="hidden lg:flex flex-col min-w-0">
                <span className="text-sm font-medium text-white truncate">Xertica Enterprise</span>
                <span className="text-[10px] text-slate-400">B2G Intelligence</span>
              </div>
            </div>
          </aside>

          {/* ── Main Area ── */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

            {/* Inner header */}
            <header className="app-header">
              <h1 className="text-lg font-heading font-bold text-slate-800 hidden md:block truncate">
                Inteligência de Vendas Governamentais
              </h1>
              <div className="flex items-center gap-3 ml-auto shrink-0">
                <Link
                  href="/chat"
                  className="copilot-btn"
                >
                  {/* Sparkles */}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
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

        </div>
        <ChatWidget />
      </body>
    </html>
  );
}

