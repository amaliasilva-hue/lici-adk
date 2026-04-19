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
          <header className="border-b border-white/10 bg-navy/80 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-8">
                <Link
                  href="/"
                  className="font-poppins font-bold text-xl text-white tracking-tight"
                >
                  <span className="text-green-accent">x</span>-lici
                </Link>
                <nav className="hidden sm:flex gap-5 text-sm font-medium text-white/60">
                  {NAV.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="hover:text-white transition-colors"
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
