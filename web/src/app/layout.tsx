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
    <html lang="pt-BR" className="dark">
      <body className="text-slate-300 antialiased" style={{ background: 'var(--bg-deep)' }}>
        {/* ── Brandbook background effects ── */}
        <div className="bg-grid" aria-hidden="true" />
        <div className="bg-orbs" aria-hidden="true">
          <div className="orb orb-cyan" />
          <div className="orb orb-pink" />
          <div className="orb orb-green" />
        </div>
        <div className="noise-overlay" aria-hidden="true" />
        {/* ── Premium Header ── */}
        <header className="sticky top-0 z-50 header-border"
            style={{ background: 'rgba(5,14,31,0.90)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
          <div className="max-w-screen-2xl mx-auto px-8 flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-3 shrink-0 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/xertica.ai/Copy%20of%20Logo_XERTICA_white.png"
                  alt="Xertica"
                  className="h-6 w-auto opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="hidden sm:flex items-center gap-2">
                  <span className="w-px h-4 bg-white/10" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/40">
                    Licitações
                  </span>
                </div>
              </Link>

              <NavLinks />
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-[11px] text-white/20 font-medium tracking-wide">
                Xertica Enterprise
              </span>
              <NotificationBell />
              {/* Xertica X symbol avatar — white variant to stay visible on dark bg */}
              <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/15 shadow-lg shadow-black/30 hover:ring-white/30 transition-all bg-black/20">
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

        <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
          {children}
        </main>
        <ChatWidget />
      </body>
    </html>
  );
}

