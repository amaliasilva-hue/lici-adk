import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import SessionProviderWrapper from './session-provider';
import { AuthGate } from './auth-gate';

export const metadata: Metadata = {
  title: 'x-lici · Xertica',
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
    <html lang="pt-BR">
      <body>
        <SessionProviderWrapper>
          <header className="border-b border-white/8 sticky top-0 z-50"
            style={{ background: 'rgba(14,24,40,0.92)', backdropFilter: 'blur(18px)' }}>
            <div className="max-w-screen-xl mx-auto px-6 py-0 flex items-center justify-between h-14">
              <div className="flex items-center gap-8">
                <Link href="/" className="flex items-center gap-2.5 shrink-0">
                  {/* Xertica white logo */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)/xertica.ai/Copy%20of%20Logo_XERTICA_white.png"
                    alt="Xertica"
                    className="h-6 w-auto"
                  />
                  <span className="font-poppins font-bold text-base text-white/90 tracking-tight">
                    x-lici
                  </span>
                  <span className="hidden sm:inline text-white/20 text-xs ml-0.5">Beta</span>
                </Link>
                <nav className="hidden sm:flex gap-1 text-sm font-medium">
                  {NAV.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="px-3 py-1.5 rounded-lg text-white/55 hover:text-white hover:bg-white/8 transition-colors"
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
              <AuthGate />
            </div>
          </header>
          <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
            {children}
          </main>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
