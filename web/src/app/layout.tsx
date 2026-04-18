import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import SessionProviderWrapper from './session-provider';
import { AuthGate } from './auth-gate';

export const metadata: Metadata = {
  title: 'lici-adk · Xertica',
  description: 'Análise de licitações públicas com IA agêntica',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SessionProviderWrapper>
          <header className="bg-white border-b border-slate-200">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <Link href="/" className="font-bold text-xertica-700 text-lg">lici-adk</Link>
                <nav className="flex gap-4 text-sm text-slate-600">
                  <Link href="/" className="hover:text-xertica-700">Nova análise</Link>
                  <Link href="/analises" className="hover:text-xertica-700">Histórico</Link>
                </nav>
              </div>
              <AuthGate />
            </div>
          </header>
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
