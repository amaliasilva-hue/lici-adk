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
        {/* ── Header ── */}
        <header className="sticky top-0 z-50"
            style={{ background: 'rgba(248,250,252,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="max-w-screen-2xl mx-auto px-8 flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-3 shrink-0 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/xertica.ai/logo_XERTICA_blue.png"
                  alt="Xertica"
                  className="h-6 w-auto opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="hidden sm:flex items-center gap-2">
                  <span className="w-px h-4 bg-slate-200" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Licitações
                  </span>
                </div>
              </Link>

              <NavLinks />
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-[11px] text-slate-400 font-medium tracking-wide">
                Xertica Enterprise
              </span>
              <NotificationBell />
              <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-slate-200 shadow-sm hover:ring-slate-300 transition-all bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/X%20-%20simbolo/Copy%20of%20X_symbol_variation4_Red_white.png"
                  alt="Xertica"
                  className="w-full h-full object-contain p-0.5"
                />
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6">
          {children}
        </main>
        <ChatWidget />
      </body>
    </html>
  );
}

