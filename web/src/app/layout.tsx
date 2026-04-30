import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import ChatWidget from '@/components/chat-widget';

export const metadata: Metadata = {
  title: 'Licitações · Xertica',
  description: 'Análise de licitações públicas com IA agêntica',
};

const NAV = [
  { href: '/',          label: 'Pipeline' },
  { href: '/upload',    label: 'Upload' },
  { href: '/historico', label: 'Histórico' },
  { href: '/config',    label: 'Config' },
  { href: '/admin',     label: 'Admin' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="bg-navy-800 text-slate-300 antialiased">
        {/* ── Premium Header ── */}
        <header className="sticky top-0 z-50 border-b border-white/[0.06]"
            style={{ background: 'rgba(10,19,32,0.88)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
          <div className="max-w-screen-2xl mx-auto px-6 flex items-center justify-between h-14">
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
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">
                    Licitações
                  </span>
                </div>
              </Link>

              <nav className="hidden sm:flex items-center gap-0.5">
                {NAV.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium text-white/45 hover:text-white hover:bg-white/[0.06] transition-all duration-200"
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-4">
              <span className="hidden md:inline text-[11px] text-white/20 font-medium tracking-wide">
                Xertica Enterprise
              </span>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-primary to-brand-primaryLight flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-brand-primary/20">
                X
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>
        <ChatWidget />
      </body>
    </html>
  );
}
